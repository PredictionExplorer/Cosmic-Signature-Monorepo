import type { Page } from '@playwright/test';

import { mockSprint4Api } from './zh-sprint4-helpers';
import { ZH_ROUTE_FIXTURES } from './zh-route-inventory';

// lexicon-allow-start: deterministic fixtures mirror sealed backend paths and wire keys.

const NOW_SECONDS = Math.floor(Date.now() / 1_000);
const { address, cycle, actionId, tokenId, gestureId, contributionId } = ZH_ROUTE_FIXTURES;

const transaction = (id: number, timestamp = NOW_SECONDS - 300) => ({
  EvtLogId: id,
  BlockNum: 100_000 + id,
  TxId: id,
  TxHash: `0x${id.toString(16).padStart(64, '0')}`,
  TimeStamp: timestamp,
  DateTime: new Date(timestamp * 1_000).toISOString(),
});

const contractAddresses = {
  RandomWalkAddr: '0x3333333333333333333333333333333333333333',
  CosmicGameAddr: '0x4444444444444444444444444444444444444444',
  CosmicSignatureAddr: '0x5555555555555555555555555555555555555555',
  CosmicTokenAddr: '0x6666666666666666666666666666666666666666',
  CosmicDaoAddr: '0x7777777777777777777777777777777777777777',
  CharityWalletAddr: '0x8888888888888888888888888888888888888888',
  PrizesWalletAddr: '0x9999999999999999999999999999999999999999',
  StakingWalletCSTAddr: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  StakingWalletRWalkAddr: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  MarketingWalletAddr: '0xcccccccccccccccccccccccccccccccccccccccc',
  ImplementationAddr: '0xdddddddddddddddddddddddddddddddddddddddd',
};

export const dashboard = {
  CurRoundNum: cycle,
  CurNumBids: 7,
  CurPrizeAmountEth: 2.5,
  CurBidPriceEth: 0.1,
  PrizeAmountEth: 2.5,
  PrizeClaimTs: NOW_SECONDS + 7_265,
  CurRoundPrizeTime: NOW_SECONDS + 7_265,
  TsRoundStart: NOW_SECONDS - 3_600,
  LastBidderAddr: address,
  GestureCostEth: 0.1,
  StakingAmountEth: 3,
  CosmicGameBalanceEth: 36.1595,
  CharityBalanceEth: 0.5,
  NumDonatedNFTs: 0,
  NumRwalkTokensUsed: 1,
  NumVoluntaryDonations: 0,
  SumVoluntaryDonationsEth: 0,
  TotalPrizesPaidAmountEth: 1.25,
  CgPrizeRowCount: 12,
  NumRaffleEthWinners: 5,
  NumRaffleNFTWinners: 3,
  NumHolderNFTWinners: 2,
  NumRaffleEthWinnersBidding: 2,
  NumRaffleNFTWinnersBidding: 1,
  NumRaffleNFTWinnersStakingRWalk: 1,
  PrizePercentage: 25,
  ChronoWarriorPercentage: 10,
  RafflePercentage: 15,
  StakingPercentage: 20,
  CharityPercentage: 7,
  TimeIncrease: 300,
  PriceIncrease: 10,
  NanosecondsExtra: 5_000_000,
  ContractAddrs: contractAddresses,
  CurRoundStats: {
    TotalBids: 7,
    TotalEthInBidsEth: 1.5,
    TotalCstInBidsEth: 1_000,
    TotalDonatedAmountEth: 0,
    TotalDonatedNFTs: 0,
    TotalRaffleEthDepositsEth: 0.25,
    TotalRaffleNFTs: 1,
    ActivationTime: NOW_SECONDS - 60,
  },
  MainStats: {
    NumCSTokenMints: 24,
    NumBidsCST: 5,
    NumUniqueBidders: 4,
    NumUniqueWinners: 3,
    NumUniqueDonors: 2,
    NumUniqueStakersCST: 1,
    NumUniqueStakersRWalk: 1,
    TotalRaffleEthDeposits: 4,
    TotalRaffleEthWithdrawn: 3,
    NumWinnersWithPendingRaffleWithdrawal: 0,
    TotalCSTConsumedEth: 100,
    TotalMktRewardsEth: 125,
    NumMktRewards: 4,
    TotalNamedTokens: 1,
    TotalEthDonatedAmountEth: 0,
    NumCosmicGameDonations: 0,
    SumCosmicGameDonationsEth: 0,
    NumWithdrawals: 0,
    SumWithdrawals: 0,
    DonatedTokenDistribution: [],
    StakeStatisticsCST: {
      NumActiveStakers: 1,
      NumDeposits: 1,
      TotalTokensStaked: 2,
      TotalTokensMinted: 2,
      TotalRewardEth: 3,
      UnclaimedRewardEth: 0,
    },
    StakeStatisticsRWalk: {
      NumActiveStakers: 1,
      TotalTokensStaked: 1,
      TotalTokensMinted: 1,
    },
  },
};

export const tokenInfo = {
  ...transaction(tokenId),
  TokenId: tokenId,
  TokenName: '天穹',
  OwnerAddr: address,
  CurOwnerAddr: address,
  WinnerAddr: address,
  RoundNum: cycle,
  Seed: '123456789',
  MintTimeStamp: Date.UTC(2026, 0, 1, 12, 34) / 1_000,
  Staked: false,
  WasUnstaked: false,
};

export const gestureInfo = {
  BidInfo: {
    Tx: transaction(gestureId),
    BidderAddr: address,
    EthPriceEth: 0.05,
    CstPriceEth: -1,
    RoundNum: cycle,
    BidType: 0,
    CSTRewardEth: 100,
    RWalkNFTId: -1,
    NFTDonationTokenId: -1,
    NFTDonationTokenAddr: '',
    NFTTokenURI: '',
    Message: '',
    DonatedERC20TokenAddr: '',
    DonatedERC20TokenAmount: '',
    DonatedERC20TokenAmountEth: 0,
  },
  error: '',
  status: 1,
};

const contribution = {
  EvtLogId: contributionId,
  DonorAddr: address,
  RoundNum: contributionId,
  AmountEth: 1.25,
  DataJson: JSON.stringify({ title: 'Protocol work', message: 'Keep building' }),
  Tx: transaction(contributionId, 1_710_000_000),
};

export function qualityFixture(path: string): unknown {
  if (path.endsWith('/statistics/dashboard')) {
    return dashboard;
  }
  if (path.endsWith('/time/current')) {
    return { CurrentTimeStamp: NOW_SECONDS };
  }
  if (path.endsWith('/rounds/current/time')) {
    return { CurRoundPrizeTime: NOW_SECONDS + 7_265 };
  }
  if (path.endsWith('/get_banned_bids')) {
    return [];
  }
  if (path.endsWith('/bid/eth_price')) {
    return {
      AuctionDuration: '3600',
      ETHPrice: '100000000000000000',
      SecondsElapsed: '120',
    };
  }
  if (path.endsWith('/bid/cst_price')) {
    return {
      AuctionDuration: '3600',
      CSTPrice: '20000000000000000000',
      SecondsElapsed: '120',
    };
  }
  if (path.endsWith(`/bid/info/${gestureId}`)) {
    return gestureInfo;
  }
  if (path.endsWith(`/cst/info/${tokenId}`)) {
    return { TokenInfo: tokenInfo };
  }
  if (path.includes(`/cst/names/history/${tokenId}`)) {
    return { TokenNameHistory: [] };
  }
  if (path.includes(`/cst/transfers/all/${tokenId}/`)) {
    return { TokenTransfers: [] };
  }
  if (path.includes('/cst/names/named_only')) {
    return { NamedTokens: [tokenInfo] };
  }
  if (path.includes('/bid/used_randomwalk_nfts')) {
    return { UsedRwalkNFTs: [] };
  }
  if (path.includes('/donations/nft/list/')) {
    return { NFTDonations: [] };
  }
  if (path.includes('/ct/total_supply_history_by_date/')) {
    return {
      TotalSupplyHistory: [
        {
          Date: '20260101',
          DateTime: '2026-01-01T12:34:00Z',
          TimeStamp: Date.UTC(2026, 0, 1, 12, 34) / 1_000,
          TotalSupplyEth: 1_000,
          MintAmountEth: 1_000,
          BurnAmountEth: 0,
          AmountEth: 1_000,
          NumBids: 1,
        },
      ],
    };
  }
  if (path.endsWith('/ct/total_supply_history_by_bid')) {
    return { TotalSupplyHistory: [] };
  }
  if (path.endsWith('/ct/statistics')) {
    return { Statistics: { TotalSupply: '1000000000000000000000', TotalSupplyEth: 1_000 } };
  }
  if (path.endsWith('/cst/distribution')) {
    return { CosmicSignatureTokenDistribution: [] };
  }
  if (path.endsWith('/ct/balances')) {
    return { CosmicTokenBalances: [] };
  }
  if (path.endsWith('/statistics/unique/bidders')) {
    return { UniqueBidders: [] };
  }
  if (path.endsWith('/statistics/unique/winners')) {
    return { UniqueWinners: [] };
  }
  if (path.endsWith('/statistics/unique/donors')) {
    return { UniqueDonors: [] };
  }
  if (path.endsWith('/statistics/leaderboard/roi')) {
    return { RoiLeaderboard: [] };
  }
  if (path.endsWith('/statistics/claims/by_round')) {
    return { ClaimsByRound: [] };
  }
  if (path.includes('/prizes/history/by_user/')) {
    return { UserPrizeHistory: [] };
  }
  if (path.includes('/prizes/eth/raffle/by_user/')) {
    return { UserRaffleDeposits: [] };
  }
  if (path.includes('/raffle/nft/by_user/')) {
    return { UserRaffleNFTWinnings: [] };
  }
  if (path.includes('/user/info/')) {
    return { Gestures: [], UserInfo: null };
  }
  if (path.includes('/user/balances/')) {
    return { ETH_Balance: '0', CosmicTokenBalance: '0' };
  }
  if (path.includes(`/donations/eth/with_info/info/${contributionId}`)) {
    return { ETHDonation: contribution };
  }
  if (path.includes('/donations/eth/both/by_round/')) {
    return { CosmicGameDonations: [] };
  }
  if (path.includes('/donations/eth/both/all')) {
    return { CosmicGameDonations: [] };
  }
  if (path.includes('/donations/charity/cg_deposits')) {
    return { CharityDonations: [] };
  }
  if (path.includes('/donations/charity/voluntary')) {
    return { CharityDonations: [] };
  }
  if (path.includes('/donations/charity/withdrawals')) {
    return { CharityWithdrawals: [] };
  }
  if (path.includes('/marketing/rewards/by_user/')) {
    return { UserMarketingRewards: [] };
  }
  if (path.includes('/marketing/rewards/global/')) {
    return { MarketingRewards: [] };
  }
  if (path.includes('/system/modelist/')) {
    return { SystemModeChanges: [] };
  }
  if (path.includes('/system/admin_events/')) {
    return {
      AdminEvents: [
        {
          EvtLogId: 3,
          RecordType: 1,
          TransferType: 0,
          IntegerValue: 7,
          AddressValue: '',
          StringValue: '',
          Tx: transaction(3),
        },
      ],
    };
  }
  if (path.includes('/bid/list/by_round/')) {
    return { BidsByRound: [] };
  }
  if (path.includes('/bid/list/all/')) {
    return { Gestures: [] };
  }
  if (path.includes(`/staking/cst/actions/info/${actionId}`)) {
    return undefined;
  }

  return undefined;
}

/**
 * Installs one deterministic read-only backend for the complete Chinese route
 * inventory. Sprint 4's mature transaction fixtures remain the fallback;
 * this layer adds the statistics, content, and long-tail endpoint shapes.
 */
export async function mockZhQualityApi(page: Page): Promise<void> {
  await mockSprint4Api(page);
  await page.route('**/api/cosmicgame/**', async (route) => {
    const json = qualityFixture(new URL(route.request().url()).pathname);
    if (json === undefined) await route.fallback();
    else await route.fulfill({ json });
  });
}

// lexicon-allow-end
