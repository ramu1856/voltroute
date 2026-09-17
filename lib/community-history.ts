import { z } from 'zod';
export const stationIdSchema=z.string().regex(/^(node|way|relation)\/[1-9]\d{0,15}$/);
export const communitySchema=z.object({stationId:stationIdSchema,status:z.enum(['charged','busy','problem']),consent:z.literal(true),observedNow:z.literal(true)}).strict();
export const reportIdSchema=z.string().uuid();
export type SharedObservation={id:string;status:'charged'|'busy'|'problem';reportedAt:number;mine:boolean;visibility:string};
export const historySQL={
 privateList:'SELECT id,status,reported_at AS reportedAt FROM station_history WHERE owner=? AND station=? ORDER BY reported_at DESC LIMIT 100',
 sharedList:"SELECT id,status,reported_at AS reportedAt,CASE WHEN owner=? THEN 1 ELSE 0 END AS mine,visibility FROM community_reports WHERE station=? AND reported_at>=? AND reported_at<=? AND (visibility='shared' OR owner=?) ORDER BY reported_at DESC LIMIT 100",
 share:"INSERT INTO community_reports(id,owner,station,status,day,reported_at,visibility) VALUES(?,?,?,?,?,?,'shared') ON CONFLICT(owner,station,day) DO UPDATE SET status=excluded.status,reported_at=excluded.reported_at,visibility='shared' WHERE community_reports.visibility!='hidden' AND NOT EXISTS(SELECT 1 FROM community_flags WHERE report=community_reports.id)",
 withdraw:"UPDATE community_reports SET visibility='withdrawn' WHERE id=? AND owner=?",
 flag:"INSERT OR IGNORE INTO community_flags(report,owner,reported_at) SELECT id,?,? FROM community_reports WHERE id=? AND owner!=? AND visibility='shared'",
 hide:"UPDATE community_reports SET visibility='hidden' WHERE id=? AND visibility='shared' AND EXISTS(SELECT 1 FROM community_flags WHERE report=community_reports.id AND owner=?)",
};
export function historySummary(entries:SharedObservation[]){
 const shared=entries.filter(e=>e.visibility==='shared');
 return {total:shared.length,charged:shared.filter(e=>e.status==='charged').length,busy:shared.filter(e=>e.status==='busy').length,problem:shared.filter(e=>e.status==='problem').length};
}
