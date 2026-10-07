const { DataSource } = require('typeorm');
const ds = new DataSource({
  type: 'postgres',
  url: 'postgresql://tema:tema@localhost:5432/tema_project_manager'
});
ds.initialize().then(async () => {
  const result = await ds.query(`
    SELECT u.id, u.name, u.email
    FROM users u
    WHERE (SELECT count(*) FROM external_accounts ea WHERE ea.user_id = u.id) = 0
  `);
  
  for (const u of result) {
    if (u.name.startsWith('Test ')) {
      const emailPrefix = u.email.split('@')[0];
      const expectedOldName = 'Test ' + emailPrefix;
      
      // Solo borramos "Test " si el nombre fue claramente auto-generado por el backend antiguo
      if (u.name.toLowerCase() === expectedOldName.toLowerCase()) {
        const newName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
        await ds.query('UPDATE users SET name = $1 WHERE id = $2', [newName, u.id]);
        console.log(`Reparado usuario ${u.email}: '${u.name}' -> '${newName}'`);
      }
    }
  }
  await ds.destroy();
}).catch(console.error);
