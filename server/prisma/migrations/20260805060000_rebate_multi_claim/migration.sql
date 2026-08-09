-- 自助回水：允许同一自然日多次领取（领完后新流水重新累计）
DROP INDEX IF EXISTS "DailyRebateSettlement_playerId_rebateDate_key";
