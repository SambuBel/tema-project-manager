const { DataSource } = require('typeorm');
const ds = new DataSource({
  type: 'postgres',
  url: 'postgresql://tema:tema@localhost:5432/tema_project_manager'
});
ds.initialize().then(async () => {
  const result = await ds.query(`
    SELECT u.id, u.name, u.email, 
           (SELECT count(*) FROM external_accounts ea WHERE ea.user_id = u.id) as ext_count
    FROM users u
    WHERE (SELECT count(*) FROM external_accounts ea WHERE ea.user_id = u.id) = 0
  `);
  console.log('Dummy users (no external auth):', result);
  await ds.destroy();
}).catch(console.error);
