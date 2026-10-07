const fs = require('fs');
let code = fs.readFileSync('apps/backend/src/projects/projects.service.ts', 'utf8');

// Fix testAcceptInvitation
code = code.replace(/const member = membersRepo\.create\(\{[\s\S]*?\}\);\s*await membersRepo\.save\(member\);/, `let member = await membersRepo.findOne({ where: { projectId, userId: targetUser.id } });
      if (member) {
        if (member.removedAt !== null) {
          member.removedAt = null;
          member.projectRole = invitation.projectRole;
          await membersRepo.save(member);
        }
        // If already active, just proceed to mark invitation as accepted.
      } else {
        member = membersRepo.create({
          projectId,
          userId: targetUser.id,
          projectRole: invitation.projectRole,
        });
        await membersRepo.save(member);
      }`);

// Fix addMember
code = code.replace(/const existing = await manager\.findOne\(ProjectMemberEntity, \{\s*where: \{ projectId, userId: dto\.userId, removedAt: IsNull\(\) \},\s*\}\);/, `const existing = await manager.findOne(ProjectMemberEntity, {
        where: { projectId, userId: dto.userId },
      });`);
code = code.replace(/if \(existing\) \{\s*throw new ConflictException\(\`El usuario ya es miembro activo de este proyecto\`\);\s*\}/, `if (existing && existing.removedAt === null) {
        throw new ConflictException(\`El usuario ya es miembro activo de este proyecto\`);
      }`);
code = code.replace(/const member = manager\.create\(ProjectMemberEntity, \{\s*projectId,\s*userId: dto\.userId,\s*projectRole: dto\.projectRole as unknown as ProjectMemberRoleEnum,\s*\}\);\s*const savedMember = await manager\.save\(member\);/, `let savedMember: ProjectMemberEntity;
      if (existing && existing.removedAt !== null) {
        existing.removedAt = null;
        existing.projectRole = dto.projectRole as unknown as ProjectMemberRoleEnum;
        savedMember = await manager.save(existing);
      } else {
        const member = manager.create(ProjectMemberEntity, {
          projectId,
          userId: dto.userId,
          projectRole: dto.projectRole as unknown as ProjectMemberRoleEnum,
        });
        savedMember = await manager.save(member);
      }`);

fs.writeFileSync('apps/backend/src/projects/projects.service.ts', code);
