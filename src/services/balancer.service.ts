import {
  BalancerError,
  BalancerErrorCode,
  BalancerSDK,
  BalancerSdkConfig,
  Network,
} from '@defiverse/balancer-sdk';
import { ethers, Contract } from 'ethers';
import BigNumber from 'bignumber.js';
import CONFIG from '@/services/config';
import { NETWORKS } from '@/constants/networks.constant';
import AbiERC20 from '@/abis/ERC20.json';

const network = NETWORKS[CONFIG.NETWORK];

const config: BalancerSdkConfig = {
  network: network.CHAIN_ID,
  rpcUrl: network.RPC_URL,
};

export const balancerVault = CONFIG.VAULT;

export const balancer = new BalancerSDK(config);
export const signer = new ethers.Wallet(
  CONFIG.SIGNER_PRIVATE_KEY,
  balancer.provider,
);
export const signerAddress = CONFIG.SIGNER_ADDRESS;

export const getPoolByPoolId = async (poolId: string) => {
  const pool = await balancer.pools.find(poolId);
  if (!pool) throw new BalancerError(BalancerErrorCode.POOL_DOESNT_EXIST);

  return pool;
};

export const checkAndSetAllowanceForVault = async ({ token, amount }) => {
  return await checkAndSetAllowance({
    token,
    spender: balancerVault,
    amount,
  });
};

export const checkAndSetAllowance = async ({ token, spender, amount }) => {
  if (token.address === ethers.constants.AddressZero) {
    return;
  }

  const erc20 = new Contract(token.address, AbiERC20, signer);
  const allowance = await erc20.allowance(signerAddress, spender);
  console.log(`[${token.symbol}] => allowance: ${allowance.toString()}`);

  if (amount.gt(allowance.toString())) {
    const estimation = await erc20.estimateGas.approve(
      spender,
      ethers.constants.MaxUint256,
    );
    console.log('gas estimation: ', estimation.toString());

    const approveTx = await erc20.approve(
      spender,
      ethers.constants.MaxUint256,
      {
        gasLimit: estimation.toString(),
      },
    );
    return await approveTx.wait();
  }

  return true;
};
