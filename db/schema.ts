import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
export const savedItems = sqliteTable('saved_items', {
  owner: text('owner').notNull(), id: text('id').notNull(), kind: text('kind').notNull(),
  payload: text('payload').notNull(), updated: integer('updated').notNull(),
}, (t) => [primaryKey({ columns: [t.owner, t.id] })]);
export const providerCache = sqliteTable('provider_cache', {
  key: text('key').primaryKey(), payload: text('payload').notNull(), expires: integer('expires').notNull(),
});
export const providerLimits = sqliteTable('provider_limits', {
  key: text('key').primaryKey(), next: integer('next').notNull(),
});
export const stationHistory=sqliteTable('station_history',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),station:text('station').notNull(),status:text('status').notNull(),reportedAt:integer('reported_at').notNull(),
},t=>[index('history_owner_station').on(t.owner,t.station,t.reportedAt)]);
export const communityReports=sqliteTable('community_reports',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),station:text('station').notNull(),status:text('status').notNull(),day:text('day').notNull(),reportedAt:integer('reported_at').notNull(),visibility:text('visibility').notNull().default('shared'),
},t=>[uniqueIndex('community_one_daily').on(t.owner,t.station,t.day),index('community_station_time').on(t.station,t.reportedAt)]);
export const communityFlags=sqliteTable('community_flags',{
 report:text('report').notNull().references(()=>communityReports.id),owner:text('owner').notNull(),reportedAt:integer('reported_at').notNull(),
},t=>[primaryKey({columns:[t.report,t.owner]})]);
