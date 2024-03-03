import {
  BatchSwapStep,
  QuerySimpleFlashSwapResponse,
  PoolToken,
  PoolWithMethods,
  SwapType,
} from '@defiverse/balancer-sdk';
import { BytesLike } from 'ethers';
import { sum } from 'lodash';
import lockfile from 'lockfile';
import { logger, telegramService } from '../index.service';
import { TransactionModel } from '@/models';
import { balancerVault, signer } from '@/services/balancer.service';
import { sleep } from '@/utils/common.util';

export type PairPool = {
  symbols: string;
  minProfit: number;
  minAmount: number;
  milestone: number;
  poolIds: Array<string>;
};

export type PairType = {
  symbols: string;
  minProfit: number;
  minAmount: number;
  milestone: number;
  pairs: Array<string>;
};
export abstract class Arbitrage {
  protected flag: boolean = false;
  protected lockedFilePath: string = 'arbitrage.lock';
  protected name: string = 'Arbitrage';

  abstract getPairs(): Array<PairType | PairPool>;
  abstract handlePair(pair: PairType | PairPool): Promise<void>;
  abstract getProfit(
    params:
      | {
          flashLoanAmount: string;
          poolIds: Array<string>;
          assets: Array<string>;
        }
      | {
          kind: SwapType;
          swaps: BatchSwapStep[];
          assets: Array<string>;
        },
  ): Promise<QuerySimpleFlashSwapResponse>;
  abstract trade(
    params:
      | {
          flashLoanAmount: string;
          poolIds: Array<string>;
          assets: Array<string>;
        }
      | {
          kind: SwapType;
          swaps: BatchSwapStep[];
          assets: Array<string>;
        },
  );

  getState() {
    return this.flag;
  }

  async start() {
    if (this.flag) {
      logger.info(`${this.name} was started`);
      return;
    }
    await lockfile.unlockSync(this.lockedFilePath);

    const pairs = await this.getPairs();
    if (pairs.length == 0) {
      return;
    }

    this.flag = true;
    await this.handleProcess();
  }

  async end() {
    this.flag = false;
    await lockfile.unlockSync(this.lockedFilePath);
  }

  private async handleProcess() {
    while (this.flag) {
      const pairs = await this.getPairs();
      for (const pair of pairs) {
        if (!this.flag) {
          return;
        }
        await this.handlePair(pair);
      }
    }
  }

  protected getAssetIndex(pool: PoolWithMethods, symbol: string) {
    const index = pool.tokens.findIndex(
      (item: PoolToken) => item.symbol === symbol,
    );
    if (index < 0) {
      throw new Error(`Can not find ${symbol} in pool: ${pool.id}`);
    }
    return index;
  }

  protected async sendTransaction(data: BytesLike) {
    const receipt = await (
      await signer.sendTransaction({
        data,
        to: balancerVault,
      })
    ).wait();
    return receipt;
  }

  protected async waitUntilUnlock() {
    let locked = false;
    do {
      await sleep(50);
      if (!this.flag) {
        await lockfile.unlockSync(this.lockedFilePath);
        return;
      }

      locked = await lockfile.checkSync(this.lockedFilePath);
    } while (locked);
  }

  protected calcProfit(profits: string[]) {
    return sum(profits);
  }

  protected async recordTransaction(
    pair: string,
    profit: String,
    transactionHash: string,
    token1?: any,
    profitToEth?: any,
  ) {
    await TransactionModel.create({
      pair,
      profit,
      transactionHash,
    });
    logger.info(
      `Actual: Arbitrage ${pair} with profit ${profitToEth} ${token1.symbol} TransactionHash: ${transactionHash}`,
    );
    telegramService.sendMessage(
      `Arbitrage ${pair} with profit  ${profitToEth} ${token1.symbol} TransactionHash: ${transactionHash}`,
    );
  }
}
