/** 七个聊天室彩票 gameCode */
export const CHAT_LOTTERY_GAMES = [
  'ssc',
  'ffc',
  'kuai3',
  'bjsc',
  'speed-racing',
  'speed-boat',
  'lhc',
] as const;

export type ChatLotteryGame = (typeof CHAT_LOTTERY_GAMES)[number];

export type RoomChatKind =
  | 'bet'
  | 'close'
  | 'result'
  | 'bet_verify'
  | 'win_verify'
  | 'system';

export interface RoomChatPlayLine {
  play: string;
  amount: number;
  betType?: string;
  betValue?: string;
}

export interface RoomChatBetPayload {
  text: string;
  issueNo: string;
  plays?: RoomChatPlayLine[];
  totalAmount?: number;
}

export interface RoomChatClosePayload {
  issueNo: string;
}

export interface RoomChatResultPayload {
  issueNo: string;
  nums: number[];
}

export interface RoomChatVerifyUser {
  name: string;
  isMe?: boolean;
  isRobot?: boolean;
  total: number;
  tags: Array<{ play: string; amount: number }>;
  /** win_verify */
  profit?: number;
  winAmount?: number;
}

export interface RoomChatBetVerifyPayload {
  issueNo: string;
  users: RoomChatVerifyUser[];
}

export interface RoomChatWinVerifyPayload {
  issueNo: string;
  users: RoomChatVerifyUser[];
  empty?: boolean;
}

export interface RoomChatMessageDto {
  id: string;
  gameCode: string;
  kind: RoomChatKind;
  issueNo: string | null;
  senderId: string | null;
  senderName: string;
  senderAvatar: string | null;
  isRobot: boolean;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function isChatLotteryGame(code: string): code is ChatLotteryGame {
  return (CHAT_LOTTERY_GAMES as readonly string[]).includes(code);
}
