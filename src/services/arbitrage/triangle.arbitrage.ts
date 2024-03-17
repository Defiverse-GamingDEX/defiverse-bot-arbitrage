import {
  BatchSwapStep,
  QuerySimpleFlashSwapResponse,
  SwapType,
  Swaps,
} from '@defiverse/balancer-sdk';
import BigNumber from 'bignumber.js';
import lockfile from 'lockfile';
import { configurationService, logger } from '@/services/index.service';
import { Arbitrage, PairType } from './base.arbitrage';
import {
  balancer,
  getPoolByPoolId,
  signerAddress,
  checkAndSetAllowanceForVault,
} from '@/services/balancer.service';
import CONFIG from '@/services/config';

class TriangleArbitrage extends Arbitrage {
  protected lockedFilePath: string = 'triangle.arbitrage.lock';
  protected name: string = 'TriangleArbitrage';

  async handlePair(pair: PairType) {
    try {
      await this.waitUntilUnlock();
      if (!this.flag) {
        return;
      }
      await lockfile.lockSync(this.lockedFilePath);

      const pool1 = await getPoolByPoolId(pair.pairs[0]);
      const pool2 = await getPoolByPoolId(pair.pairs[1]);
      const pool3 = await getPoolByPoolId(pair.pairs[2]);

      const [symbol1, symbol2, symbol3] = pair.symbols.split('-');

      const token1 = pool1.tokens[this.getAssetIndex(pool1, symbol1)];
      const token2 = pool2.tokens[this.getAssetIndex(pool2, symbol2)];
      const token3 = pool3.tokens[this.getAssetIndex(pool3, symbol3)];

      for (const token of [token1, token2, token3]) {
        await checkAndSetAllowanceForVault({
          token: token,
          amount: new BigNumber(1000000000).multipliedBy(
            new BigNumber(10).pow(token.decimals),
          ),
        });
      }

      const data = {
        kind: SwapType.SwapExactIn,
        swaps: [
          {
            poolId: pool1.id,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: new BigNumber(pair.minAmount)
              .multipliedBy(new BigNumber(10).pow(token1.decimals))
              .toString(),
            userData: '0x',
          },
          {
            poolId: pool2.id,
            assetInIndex: 1,
            assetOutIndex: 2,
            amount: '0',
            userData: '0x',
          },
          {
            poolId: pool3.id,
            assetInIndex: 2,
            assetOutIndex: 0,
            amount: '0',
            userData: '0x',
          },
        ],
        assets: [token1.address, token2.address, token3.address],
        funds: {
          fromInternalBalance: false,
          recipient: signerAddress,
          sender: signerAddress,
          toInternalBalance: false,
        },
        milestone: new BigNumber(pair.milestone)
          .multipliedBy(new BigNumber(10).pow(token1.decimals))
          .toString(),
        symbols: pair.symbols,
      };

      const profit = await this.getProfit(data);

      console.log('profit: ', pair.symbols, profit);
      const isGreatThanMinProfit = new BigNumber(profit.profit).gte(
        new BigNumber(pair.minProfit).multipliedBy(
          new BigNumber(10).pow(token1.decimals),
        ),
      );

      if (profit.isProfitable && isGreatThanMinProfit) {
        const profitToEth = new BigNumber(profit.profit).dividedBy(
          new BigNumber(10).pow(token1.decimals),
        );
        logger.info(
          `Expected: Pair ${pair.symbols} has profit ${profitToEth.toString()} ${token1.symbol}`,
        );
        const tx = await this.trade({
          ...data,
          profit,
        });
        if (tx) {
          await this.recordTransaction(
            `${pair.symbols}`,
            profit.profit,
            tx,
            token1,
            profitToEth,
          );
        }
      }
    } catch (error) {
      logger.error(error, `${this.name}.handlePair`);
    } finally {
      await lockfile.unlockSync(this.lockedFilePath);
    }
  }

  getPairs(): Array<PairType> {
    return CONFIG.TRIANGLE_ARBITRAGE.PAIRS;
  }

  private deltaToExpectedProfit(delta: string) {
    return Number(delta) * -1;
  }

  async getProfit({
    kind,
    assets,
    swaps,
    funds,
    milestone,
    symbols,
  }: {
    kind: SwapType;
    swaps: BatchSwapStep[];
    assets: Array<string>;
    funds: Object;
    milestone: string;
    symbols?: string;
  }): Promise<
    QuerySimpleFlashSwapResponse & { profit: string; amount: string }
  > {
    try {
      let results = {
        profit: 0,
        profits: {},
      };

      const steps = [...Array(CONFIG.TRIANGLE_ARBITRAGE.RETRY).keys()];

      for (const step of steps) {
        try {
          swaps[0].amount = new BigNumber(swaps[0].amount)
            .plus(new BigNumber(milestone).multipliedBy(step))
            .toFixed(0);

          const deltas =
            await balancer.contracts.vault.callStatic.queryBatchSwap(
              kind,
              swaps,
              assets,
              funds as any,
            );

          const profits = {
            [assets[0]]: this.deltaToExpectedProfit(
              deltas[0].toString(),
            ).toString(),
            [assets[1]]: this.deltaToExpectedProfit(
              deltas[1].toString(),
            ).toString(),
            [assets[2]]: this.deltaToExpectedProfit(
              deltas[2].toString(),
            ).toString(),
          };

          const profit = this.calcProfit([
            profits[assets[0]],
            profits[assets[1]],
            profits[assets[2]],
          ]);

          logger.info(
            `profit: ${profit}`,
            `${this.name}.getProfit ${symbols} => amount: ${swaps[0].amount}`,
          );

          if (profit > results.profit) {
            results.profit = profit;
            results.profits = profits;
          }
        } catch (error) {
          logger.error(
            error?.message || error,
            `${this.name}.getProfit ${symbols} => amount: ${swaps[0].amount}`,
          );
        }
      }

      return {
        profits: results.profits,
        isProfitable: results.profit > 0,
        profit: String(results.profit),
        amount: swaps[0].amount,
      };
    } catch (error) {
      logger.error(error, `${this.name}.getProfit ${symbols}`);
      return {
        isProfitable: false,
        profits: {},
        profit: '0',
        amount: swaps[0].amount,
      };
    }
  }

  async trade({
    kind,
    assets,
    swaps,
    profit,
  }: {
    kind: SwapType;
    swaps: BatchSwapStep[];
    assets: Array<string>;
    profit: any;
  }) {
    try {
      const encodeData = Swaps.encodeBatchSwap({
        assets,
        kind,
        swaps,
        funds: {
          fromInternalBalance: false,
          recipient: signerAddress,
          sender: signerAddress,
          toInternalBalance: false,
        },
        limits: [profit.amount, '0', '0'], // +ve for max to send, -ve for min to receive
        deadline: '999999999999999999', // Infinity
      });
      const receipt = await this.sendTransaction(encodeData);
      return receipt.transactionHash;
    } catch (error) {
      logger.error(error, `${this.name}.trade`);
      return null;
    }
  }
}

const triangleArbitrageService = new TriangleArbitrage();
export default triangleArbitrageService;
