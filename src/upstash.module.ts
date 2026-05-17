import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';

export const UPSTASH_REDIS = 'UPSTASH_REDIS';

@Global()
@Module({
  providers: [
    {
      provide: UPSTASH_REDIS,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new Redis({
          url: configService.get<string>('UPSTASH_REDIS_REST_URL')!,
          token: configService.get<string>('UPSTASH_REDIS_REST_TOKEN')!,
        }),
    },
  ],
  exports: [UPSTASH_REDIS],
})
export class UpstashModule {}
