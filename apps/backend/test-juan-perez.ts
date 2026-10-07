import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { ProjectsService } from './src/projects/projects.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const projectsService = app.get(ProjectsService);
  
  const projectId = '06ae8254-a4be-4b06-87cc-827234dfce27';
  const leaderId = '88d76a3d-61c8-4aa0-9534-286fcdde3eb9';
  const user = { id: leaderId, roles: ["PROJECT_MANAGER"] } as any;

  try {
    // 1. Invite "Juan Pérez" with email "romanouziel0.20@gmail.com"
    console.log('Inviting Juan Pérez...');
    const inv = await projectsService.inviteMember(projectId, {
      email: 'romanouziel0.20@gmail.com',
      name: 'Juan Pérez',
      projectRole: 'COLLABORATOR' as any
    }, user);
    console.log('Created invitation:', inv.id, inv.name);

    // 2. Test Accept
    console.log('Test accepting invitation...');
    await projectsService.testAcceptInvitation(projectId, inv.id, user);
    console.log('Test accepted successfully!');

    // 3. Verify User Name
    const ds = app.get('DataSource');
    const updatedUser = await ds.query(`SELECT id, name FROM users WHERE email = 'romanouziel0.20@gmail.com'`);
    console.log('Updated User Name is:', updatedUser[0].name);

  } catch (err) {
    console.error('Error during test:', err);
  }

  await app.close();
}
run();
