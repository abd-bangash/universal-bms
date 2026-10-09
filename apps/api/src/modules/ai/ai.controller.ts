import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { NotFoundAppException } from '../../common/errors/app.exception';
import { keysetCursor, keysetWhere, toPage } from '../../common/pagination/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiService, type AiFunction } from './ai.service';
import {
  ApplySuggestionDto,
  CreateKnowledgeDto,
  ListLogsQuery,
  UpdateKnowledgeDto,
} from './dto/ai.dto';
import { KnowledgeService } from './knowledge.service';

class IdParam {
  @IsString() id!: string;
}

const FUNCTION_ROUTES: Record<string, AiFunction> = {
  summarize: 'SUMMARIZE',
  extract: 'EXTRACT',
  'draft-reply': 'DRAFT_REPLY',
  classify: 'CLASSIFY',
  'next-action': 'NEXT_ACTION',
  note: 'NOTE',
};

class FunctionParam {
  @IsString() id!: string;
  @IsString() fn!: string;
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly knowledge: KnowledgeService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  @RequirePermission('ai:use')
  status() {
    return this.ai.status();
  }

  @Get('conversations/:id/suggestions')
  @RequirePermission('ai:use')
  suggestions(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.ai.suggestions(user, p.id);
  }

  /** summarize | extract | draft-reply | classify | next-action | note */
  @Post('conversations/:id/:fn')
  @HttpCode(200)
  @RequirePermission('ai:use')
  run(@CurrentUser() user: AuthUser, @Param() p: FunctionParam) {
    const fn = FUNCTION_ROUTES[p.fn];
    if (!fn) throw new NotFoundAppException();
    return this.ai.runFor(user, p.id, fn);
  }

  @Post('suggestions/:id/apply')
  @HttpCode(200)
  @RequirePermission('ai:use')
  apply(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: ApplySuggestionDto) {
    return this.ai.apply(user, p.id, dto.payload);
  }

  @Post('suggestions/:id/reject')
  @HttpCode(200)
  @RequirePermission('ai:use')
  reject(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.ai.reject(user, p.id);
  }

  @Get('logs')
  @RequirePermission('ai:view_logs')
  async logs(@Query() query: ListLogsQuery) {
    const after = keysetWhere('createdAt', 'desc', query.cursor, true);
    const rows = await this.prisma.scoped.aIActionLog.findMany({
      where: after ? (after as object) : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) => keysetCursor(last.createdAt, last.id)).map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      suggestionId: r.suggestionId,
      actionType: r.actionType,
      providerName: r.providerName,
      modelVersion: r.modelVersion,
      promptVersion: r.promptVersion,
      promptHash: r.promptHash,
      responseHash: r.responseHash,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      latencyMs: r.latencyMs,
      confidenceScore: r.confidenceScore ? Number(r.confidenceScore) : null,
      outcome: r.outcome,
      error: r.error,
      humanApproved: r.humanApproved,
      approvedById: r.approvedById,
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ── the business's approved answers ─────────────────────────────────────────────────────

  @Get('knowledge')
  @RequirePermission('ai:control')
  listKnowledge() {
    return this.knowledge.list();
  }

  @Post('knowledge')
  @RequirePermission('ai:control')
  createKnowledge(@CurrentUser() user: AuthUser, @Body() dto: CreateKnowledgeDto) {
    return this.knowledge.create(user, dto);
  }

  @Patch('knowledge/:id')
  @RequirePermission('ai:control')
  updateKnowledge(@Param() p: IdParam, @Body() dto: UpdateKnowledgeDto) {
    return this.knowledge.update(p.id, dto);
  }

  @Delete('knowledge/:id')
  @HttpCode(204)
  @RequirePermission('ai:control')
  removeKnowledge(@Param() p: IdParam) {
    return this.knowledge.remove(p.id);
  }
}
