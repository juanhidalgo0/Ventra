import { BadRequestException, Controller, Param, Post, Request, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { ContactImportService } from './contact-import.service';
import { ContactKind } from './contact-import';

/** Importar clientes o proveedores desde una planilla de otro sistema (solo el dueño: carga saldos) */
@Controller('contacts-import')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ContactImportController {
  constructor(private readonly importer: ContactImportService) {}

  @Post(':kind/preview')
  @UseInterceptors(FileInterceptor('file'))
  preview(@Param('kind') kind: ContactKind, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    return this.importer.preview(file.buffer, kind);
  }

  @Post(':kind')
  @UseInterceptors(FileInterceptor('file'))
  run(@Param('kind') kind: ContactKind, @UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    return this.importer.run(file.buffer, kind, req.user?.sub);
  }
}
