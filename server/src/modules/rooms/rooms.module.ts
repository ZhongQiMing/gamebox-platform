import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { RoomChatService } from './room-chat.service';
import { RoomChatScheduler } from './room-chat.scheduler';

@Module({
  controllers: [RoomsController],
  providers: [RoomsService, RoomChatService, RoomChatScheduler],
  exports: [RoomsService, RoomChatService],
})
export class RoomsModule {}
