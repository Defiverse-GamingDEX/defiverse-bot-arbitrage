import { QuerySimpleFlashSwapResponse, Swaps } from '@defiverse/balancer-sdk';
import BigNumber from 'bignumber.js';

import lockfile from 'lockfile';
import { configurationService, logger } from '@/services/index.service';
import { Arbitrage, PairPool } from './base.arbitrage';
import {
  balancer,
  getPoolByPoolId,
  signerAddress,
  checkAndSetAllowanceForVault
} from '@/services/balancer.service';
import CONFIG from '@/services/config';

class PairArbitrage extends Arbitrage {
  protected lockedFilePath: string = 'pair.arbitrage.lock';
  protected name: string = 'PairArbitrage';

  async handlePair(pair: PairPool) {
    try {
      await this.waitUntilUnlock();
      if (!this.flag) {
        return;
      }
      await lockfile.lockSync(this.lockedFilePath);

      const pool1 = await getPoolByPoolId(pair.poolIds[0]);
      const pool2 = await getPoolByPoolId(pair.poolIds[1]);

      const [symbol1, symbol2] = pair.symbols.split('-');

      const token1 = pool1.tokens[this.getAssetIndex(pool1, symbol1)];
      const token2 = pool1.tokens[this.getAssetIndex(pool1, symbol2)];

      for (const token of [token1, token2]) {
        await checkAndSetAllowanceForVault({
          token: token,
          amount: new BigNumber(1000000000).multipliedBy(
            new BigNumber(10).pow(token.decimals),
          ),
        });
      }


      const data = {
        flashLoanAmount: new BigNumber(pair.minAmount)
          .multipliedBy(new BigNumber(10).pow(token1.decimals))
          .toString(),
        poolIds: [pool1.id, pool2.id],
        assets: [token1.address, token2.address],
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
        const tx = await this.trade(data);
        if (tx) {
          await this.recordTransaction(
            `${token1.symbol}-${token2.symbol}`,
            profit.profits[token1.address],
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

  getPairs(): Array<PairPool> {
    return CONFIG.PAIR_ARBITRAGE.PAIRS;
  }

  async getProfit({
    poolIds,
    assets,
    flashLoanAmount,
    milestone,
    symbols,
  }: {
    flashLoanAmount: string;
    poolIds: Array<string>;
    assets: Array<string>;
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

      let amount = flashLoanAmount + 0;
      const steps = [...Array(CONFIG.PAIR_ARBITRAGE.RETRY).keys()];
      for (const step of steps) {
        try {
          amount = new BigNumber(flashLoanAmount)
            .plus(new BigNumber(milestone).multipliedBy(step))
            .toString();

          const { profits } = await balancer.swaps.querySimpleFlashSwap({
            flashLoanAmount: amount,
            poolIds,
            assets,
          });
          const profit = this.calcProfit([
            profits[assets[0]],
            profits[assets[1]],
          ]);

          if (profit > results.profit) {
            results.profit = profit;
            results.profits = profits;
          }
        } catch (error) {
          logger.error(
            error?.message || error,
            `${this.name}.getProfit ${symbols} => amount: ${amount}`,
          );
        }
      }

      return {
        profits: results.profits,
        isProfitable: results.profit > 0,
        profit: String(results.profit),
        amount: amount,
      };
    } catch (error) {
      logger.error(error, `${this.name}.getProfit ${symbols}`);
      return {
        isProfitable: false,
        amount: flashLoanAmount,
        profit: '0',
        profits: {},
      };
    }
  }

  async trade({
    poolIds,
    assets,
    flashLoanAmount,
  }: {
    flashLoanAmount: string;
    poolIds: Array<string>;
    assets: Array<string>;
  }) {
    try {
      const encodeData = Swaps.encodeSimpleFlashSwap({
        flashLoanAmount,
        poolIds,
        assets,
        walletAddress: signerAddress,
      });

      const receipt = await this.sendTransaction(encodeData);
      return receipt.transactionHash;
    } catch (error) {
      logger.error(error, `${this.name}.trade`);
      return null;
    }
  }
}

const pairArbitrageService = new PairArbitrage();
export default pairArbitrageService;
