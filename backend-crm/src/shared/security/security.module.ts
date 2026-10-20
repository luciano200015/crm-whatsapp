import { Global, Module } from '@nestjs/common';
import { TokenHasher } from './token-hasher';

@Global()
@Module({
  providers: [TokenHasher],
  exports: [TokenHasher],
})
export class SecurityModule {}
