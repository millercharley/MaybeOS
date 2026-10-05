import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** The states an article may be in, mirroring the handbook's (PLT-05). */
export const ARTICLE_STATES = ['DRAFT', 'PUBLISHED'] as const;

export class CreateSupportArticleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  summary?: string;

  @IsString()
  @MaxLength(100)
  category!: string;

  @IsString()
  body!: string;
}

export class UpdateSupportArticleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsIn(ARTICLE_STATES)
  state?: (typeof ARTICLE_STATES)[number];
}

/** A screenshot, as the browser hands it back from FileReader. */
export class SupportImageDto {
  @IsString()
  data!: string;

  @IsString()
  mimeType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  caption?: string;
}
