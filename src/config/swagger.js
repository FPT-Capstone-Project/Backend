const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Capstone Backend API',
      version: '1.0.0',
      description: 'Authentication and user API using JWT.',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local development server',
      },
    ],
    tags: [
      { name: 'Health', description: 'Server health check' },
      { name: 'Authentication', description: 'Register, login and current user' },
      { name: 'Users', description: 'Authenticated user resources' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        RegisterRequest: {
          type: 'object',
          required: ['roleId', 'email', 'password', 'fullName'],
          properties: {
            roleId: { type: 'integer', example: 2 },
            email: { type: 'string', format: 'email', example: 'user@example.com' },
            password: { type: 'string', minLength: 8, example: 'password123' },
            fullName: { type: 'string', example: 'Nguyen Van A' },
            phone: { type: 'string', example: '0900000000' },
            address: { type: 'string', example: 'Ho Chi Minh City' },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'user@example.com' },
            password: { type: 'string', example: 'password123' },
          },
        },
        User: {
          type: 'object',
          properties: {
            user_id: { type: 'integer', example: 1 },
            role_id: { type: 'integer', example: 2 },
            email: { type: 'string', format: 'email', example: 'user@example.com' },
            full_name: { type: 'string', example: 'Nguyen Van A' },
            phone: { type: 'string', nullable: true, example: '0900000000' },
            address: { type: 'string', nullable: true, example: 'Ho Chi Minh City' },
            status: { type: 'string', example: 'ACTIVE' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Login successful' },
            token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            user: { $ref: '#/components/schemas/User' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Invalid email or password' },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Check API health',
          responses: {
            200: {
              description: 'API is healthy',
              content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } } } },
            },
          },
        },
      },
    },
  },
  apis: ['src/routes/*.js'],
};

module.exports = swaggerJSDoc(options);
