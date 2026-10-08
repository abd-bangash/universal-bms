import { Test } from '@nestjs/testing';
import { testEnv } from '../test/helpers/auth-app';
import { AppModule } from './app.module';
import { ENV } from './config/env';

describe('AppModule', () => {
  it('compiles', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(testEnv())
      .compile();
    expect(moduleRef).toBeDefined();
  });
});
