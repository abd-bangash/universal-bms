import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { StorageAdapter } from '@bms/types';
import type { Response } from 'express';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { NotFoundAppException } from '../../common/errors/app.exception';
import { UploadFileDto } from './dto/files.dto';
import { FilesService, type UploadedFile as UploadedFileData } from './files.service';
import { STORAGE } from './storage/storage.token';
import { LocalDiskStorage } from './storage/local-disk.storage';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    @Inject(STORAGE) private readonly storage: StorageAdapter,
  ) {}

  /** Multipart: `file` plus optional `entityType`, `entityId` and `purpose`. */
  @Post()
  @Authenticated()
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedFileData | undefined,
    @Body() dto: UploadFileDto,
  ) {
    return this.files.upload(user, file, dto);
  }

  @Get(':id/url')
  @Authenticated()
  @ApiBearerAuth()
  url(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.files.urlFor(user, id);
  }

  @Delete(':id')
  @Authenticated()
  @ApiBearerAuth()
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.files.remove(user, id);
  }

  /** Development driver only: serves a stored file for a valid, unexpired signed URL. */
  @Get('local')
  @Public()
  @SkipThrottle({ default: true })
  @SkipEnvelope()
  @Header('Cache-Control', 'private, max-age=60')
  async local(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!(this.storage instanceof LocalDiskStorage)) throw new NotFoundAppException();
    const found = await this.storage.readSigned(String(key ?? ''), Number(exp), String(sig ?? ''));
    if (!found) throw new NotFoundAppException();
    res.setHeader('Content-Type', found.mime);
    res.setHeader('Content-Disposition', 'inline');
    res.send(found.body);
  }
}
