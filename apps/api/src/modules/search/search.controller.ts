import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { SearchService } from './search.service';

class SearchQuery {
  @IsString() @MaxLength(100) q!: string;
}

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Any signed-in user may search; each group appears only if they hold its `view` permission. */
  @Get()
  @Authenticated()
  async run(@CurrentUser() user: AuthUser, @Query() query: SearchQuery) {
    return { query: query.q.trim(), groups: await this.search.search(user, query.q) };
  }
}
