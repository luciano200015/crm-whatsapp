import { Global, Module } from '@nestjs/common';
import { SecretBox } from './secret-box';
import { TokenHasher } from './token-hasher';

@Global()
@Module({
  providers: [TokenHasher, SecretBox],
  exports: [TokenHasher, SecretBox],
})
export class SecurityModule {}
