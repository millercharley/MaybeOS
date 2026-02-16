import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CommonsService } from './commons.service';
import { CommonsController } from './commons.controller';

@Module({
  controllers: [CommonsController],
  providers: [PrismaService, CommonsService],
  exports: [CommonsService],
})
export class CommonsModule {}
