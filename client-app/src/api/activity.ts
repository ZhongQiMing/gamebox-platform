import http from './http'
import { publicMediaUrl } from '@/utils/publicMediaUrl'

export interface ActivityItem {
  id: string
  code: string
  type: string
  title: string
  bannerUrl?: string
  config: {
    reward?: number
    expiresHours?: number
    tiers?: Array<{ minDeposit: number; reward: number }>
  }
  claim: {
    id: string
    status: string
    rewardPoints: number
    claimedAt: string
  } | null
}

export interface ClaimResult {
  claim: { id: string; status: string; rewardPoints: number }
  reward: number
}

export const activityApi = {
  list: () => http.get<ActivityItem[], ActivityItem[]>('/activities')
    .then((items) => items.map((item) => ({
      ...item,
      bannerUrl: publicMediaUrl(item.bannerUrl) || undefined,
    }))),
  claim: (id: string) => http.post<ClaimResult, ClaimResult>(`/activities/${id}/claim`),
}
