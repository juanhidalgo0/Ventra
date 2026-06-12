import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsIn } from 'class-validator';

class CreateUserDto {
  @IsString() @IsNotEmpty() username: string;
  @IsString() @IsNotEmpty() password: string;
  @IsString() @IsNotEmpty() fullName: string;
  @IsString() @IsIn(['ADMIN', 'SUPERVISOR', 'CASHIER']) role: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() @IsIn(['ADMIN', 'SUPERVISOR', 'CASHIER']) role?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() password?: string;
}

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get() @Roles('ADMIN', 'SUPERVISOR', 'CASHIER')
  findAll() { return this.usersService.findAll(); }

  @Patch('profile/me') @Roles('ADMIN', 'SUPERVISOR', 'CASHIER')
  updateMe(@Request() req, @Body() dto: UpdateUserDto) {
    return this.usersService.update(req.user.sub, dto);
  }

  @Get(':id') @Roles('ADMIN', 'SUPERVISOR')
  findById(@Param('id') id: string) { return this.usersService.findById(id); }

  @Post() @Roles('ADMIN')
  create(@Body() dto: CreateUserDto) { return this.usersService.create(dto); }

  @Patch(':id') @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) { return this.usersService.update(id, dto); }

  @Delete(':id') @Roles('ADMIN')
  delete(@Param('id') id: string) { return this.usersService.delete(id); }
}
