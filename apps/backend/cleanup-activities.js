const { DataSource } = require('typeorm');

const ds = new DataSource({
  type: 'postgres',
  url: 'postgresql://tema:tema@localhost:5432/tema_project_manager',
});

ds.initialize().then(async () => {
  const result = await ds.query(`SELECT id, metadata FROM project_activities WHERE metadata->>'name' LIKE 'Test %'`);
  console.log('Found activities:', result.length);
  for (const row of result) {
    const meta = row.metadata;
    meta.name = meta.name.replace('Test ', '');
    meta.name = meta.name.charAt(0).toUpperCase() + meta.name.slice(1);
    await ds.query('UPDATE project_activities SET metadata = $1 WHERE id = $2', [meta, row.id]);
    console.log('Updated activity', row.id);
  }
  await ds.destroy();
}).catch(console.error);
