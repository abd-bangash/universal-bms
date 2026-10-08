import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { ENV } from './config/env';

describe('AppModule', () => {
  it('compiles', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue({})
      .compile();
    expect(moduleRef).toBeDefined();
  });
});
