const { DataSource } = require('typeorm');
const ds = new DataSource({
  type: 'postgres',
  url: 'postgresql://tema:tema@localhost:5432/tema_project_manager'
});
ds.initialize().then(async () => {
  // Just delete all activities to be safe
  await ds.query(`DELETE FROM project_activities`);
  
  // Get all dummy users
  const dummyUsers = await ds.query(`
    SELECT id FROM users
    WHERE (SELECT count(*) FROM external_accounts ea WHERE ea.user_id = users.id) = 0
  `);
  
  const dummyIds = dummyUsers.map(u => u.id);

  if (dummyIds.length > 0) {
    const ids = dummyIds.map(id => `'${id}'`).join(',');
    
    await ds.query(`DELETE FROM project_members WHERE user_id IN (${ids})`);
    
    await ds.query(`DELETE FROM project_invitations WHERE invited_by IN (${ids}) OR email IN (SELECT email FROM users WHERE id IN (${ids}))`);
    
    await ds.query(`DELETE FROM users WHERE id IN (${ids})`);
    console.log(`Deleted ${dummyIds.length} dummy users and their related data.`);
  }

  const projects = await ds.query('SELECT id, leader_id FROM projects');
  for (const p of projects) {
    await ds.query(`DELETE FROM project_members WHERE project_id = $1 AND user_id != $2`, [p.id, p.leader_id]);
    await ds.query(`DELETE FROM project_invitations WHERE project_id = $1`, [p.id]);
  }
  
  console.log('Cleared all project members, invitations, and related activities.');

  await ds.destroy();
}).catch(console.error);
