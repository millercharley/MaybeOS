import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CommonsService } from './commons.service';
import { ThreadsService } from './threads.service';
import { CommonsController } from './commons.controller';

@Module({
  controllers: [CommonsController],
  providers: [PrismaService, CommonsService, ThreadsService],
  exports: [CommonsService, ThreadsService],
})
export class CommonsModule {}
