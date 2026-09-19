CREATE TABLE IF NOT EXISTS provider_cache (
  key TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_limits (
  key TEXT PRIMARY KEY NOT NULL,
  next INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_items (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (owner, id)
);

CREATE TABLE IF NOT EXISTS community_reports (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  station TEXT NOT NULL,
  status TEXT NOT NULL,
  day TEXT NOT NULL,
  reported_at INTEGER NOT NULL,
  visibility TEXT DEFAULT 'shared' NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS community_one_daily
  ON community_reports (owner, station, day);

CREATE INDEX IF NOT EXISTS community_station_time
  ON community_reports (station, reported_at);

CREATE TABLE IF NOT EXISTS community_flags (
  report TEXT NOT NULL,
  owner TEXT NOT NULL,
  reported_at INTEGER NOT NULL,
  PRIMARY KEY (report, owner),
  FOREIGN KEY (report) REFERENCES community_reports(id)
);

CREATE TABLE IF NOT EXISTS station_history (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  station TEXT NOT NULL,
  status TEXT NOT NULL,
  reported_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS history_owner_station
  ON station_history (owner, station, reported_at);
