import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { PrismaModule } from '../../database/prisma.module';
import { CashRegisterModule } from '../cash-register/cash-register.module';

@Module({
  imports: [PrismaModule, CashRegisterModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
