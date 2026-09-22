import sqlite3, json, time, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
DB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'demo-data', 'signal-monitor.db')
ids = json.load(open(os.path.join(HERE, 'seed-ids.json')))
db = sqlite3.connect(DB)
now = int(time.time()*1000)
H = 3600*1000
plan = {
  's1': [26, 25, 3],
  's2': [72, 70],
  's3': [120, 118, 96],
  's4': [60, 58, 30],
  's5': [40, 38, 12],
  's6': [5],
  's7': [1],
  's8': [20, 19, 2],
}
for key, hours in plan.items():
    sid = ids[key]
    rows = db.execute("SELECT id, at, kind FROM signal_history WHERE signal_id=? ORDER BY at, id", (sid,)).fetchall()
    clusters = []
    for rid, at, kind in rows:
        if clusters and kind in ('category','assign','note') and clusters[-1][-1][2] in ('category','assign','note'):
            clusters[-1].append((rid, at, kind))
        else:
            clusters.append([(rid, at, kind)])
    assert len(clusters) == len(hours), (key, len(clusters), hours, rows)
    for cluster, h in zip(clusters, hours):
        target = now - h*H
        for i, (rid, at, kind) in enumerate(cluster):
            db.execute("UPDATE signal_history SET at=? WHERE id=?", (target + i*1500, rid))
    created = now - hours[0]*H
    last = now - hours[-1]*H
    db.execute("UPDATE signals SET created_at=?, updated_at=? WHERE id=?", (created, last, sid))
    if len(hours) > 1:
        db.execute("UPDATE signals SET distributed_at=? WHERE id=? AND distributed_at IS NOT NULL", (now - hours[1]*H, sid))
        db.execute("UPDATE assignments SET assigned_at=? WHERE entity_id=?", (now - hours[1]*H, sid))
    db.execute("UPDATE signals SET closed_at=? WHERE id=? AND closed_at IS NOT NULL", (last, sid))
    db.execute("UPDATE files SET created_at=? WHERE id IN (SELECT file_id FROM attachments WHERE entity_id=?)", (created - 60000, sid))
db.execute("UPDATE users SET created_at=? WHERE role='superadmin'", (now - 30*24*H,))
db.execute("UPDATE users SET created_at=? WHERE role in ('admin','manager')", (now - 20*24*H,))
db.execute("UPDATE users SET created_at=? WHERE role='contractor'", (now - 10*24*H,))
db.execute("DELETE FROM signal_views")
db.commit()
for r in db.execute("SELECT id, sector, status, created_at, closed_at FROM signals"): print(r)
