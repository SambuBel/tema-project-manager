import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { ListNotificationsDto } from './list-notifications.dto';
import { UpdateNotificationPreferencesDto } from './update-notification-preferences.dto';
import { NotificationsService } from './notifications.service';

/**
 * Las notificaciones son siempre del usuario autenticado: no hay :userId en las rutas.
 * Las rutas fijas (unread-count, read-all, preferences) van antes que las que llevan :id.
 */
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@Query() query: ListNotificationsDto, @CurrentUser() user: RequestUser) {
    return this.notificationsService.findForUser(user.id, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: RequestUser) {
    return { count: await this.notificationsService.countUnread(user.id) };
  }

  @Get('preferences')
  getPreferences(@CurrentUser() user: RequestUser) {
    return this.notificationsService.getPreferences(user.id);
  }

  @Put('preferences')
  updatePreferences(@Body() dto: UpdateNotificationPreferencesDto, @CurrentUser() user: RequestUser) {
    return this.notificationsService.updatePreferences(user.id, dto.preferences);
  }

  @Patch('read-all')
  markAllAsRead(@CurrentUser() user: RequestUser) {
    return this.notificationsService.markAllAsRead(user.id);
  }

  @Patch(':id/read')
  markAsRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.notificationsService.markAsRead(id, user.id);
  }
}