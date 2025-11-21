export const ApiProperty = () => () => {};
export const ApiTags = () => () => {};
export const ApiBearerAuth = () => () => {};
export const ApiResponse = () => () => {};
export const ApiOperation = () => () => {};

export class DocumentBuilder {
  setTitle() {
    return this;
  }
  setDescription() {
    return this;
  }
  setVersion() {
    return this;
  }
  addBearerAuth() {
    return this;
  }
  build() {
    return {};
  }
}

export const SwaggerModule = {
  createDocument: jest.fn().mockReturnValue({}),
  setup: jest.fn(),
};
