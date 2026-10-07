const { DataSource } = require('typeorm');
const ds = new DataSource({
  type: 'postgres',
  url: 'postgresql://tema:tema@localhost:5432/tema_project_manager'
});
ds.initialize().then(async () => {
  const proj = await ds.query('SELECT id, leader_id FROM projects LIMIT 1');
  console.log('Project:', proj);
  const user = await ds.query(`SELECT id, name FROM users WHERE email = 'romanouziel0.20@gmail.com'`);
  console.log('Test User:', user);
  await ds.destroy();
}).catch(console.error);
