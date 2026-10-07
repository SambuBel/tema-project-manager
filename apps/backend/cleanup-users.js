const { DataSource } = require('typeorm');

const ds = new DataSource({
  type: 'postgres',
  url: 'postgresql://tema:tema@localhost:5432/tema_project_manager',
});

ds.initialize().then(async () => {
  const result = await ds.query(`SELECT id, name, email FROM users WHERE name LIKE 'Test %'`);
  console.log('Found users:', result);
  for (const u of result) {
    const prefix = u.email.split('@')[0];
    const newName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    await ds.query('UPDATE users SET name = $1 WHERE id = $2', [newName, u.id]);
    
    // Also update any activities where this name might be hardcoded in JSON metadata
    // Not strictly necessary since we fixed the fallback, but just in case
    
    console.log('Updated', u.id, 'to', newName);
  }
  await ds.destroy();
}).catch(console.error);
