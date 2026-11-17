const router = require('express').Router();
const controller = require('../controllers/inventory.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');
router.use(authenticate, authorizeRoles(1, 2));
/**
 * @openapi
 * {
 *   "/api/inventory/admin": {
 *     "get": {
 *       "tags": [
 *         "Inventory"
 *       ],
 *       "summary": "List spawn inventory",
 *       "description": "Admin (role_id 1) and Farm Operator (role_id 2) only.",
 *       "security": [
 *         {
 *           "bearerAuth": []
 *         }
 *       ],
 *       "responses": {
 *         "200": {
 *           "description": "Success",
 *           "content": {
 *             "application/json": {
 *               "schema": {
 *                 "type": "object",
 *                 "properties": {
 *                   "data": {
 *                     "type": "array",
 *                     "items": {
 *                       "type": "object",
 *                       "properties": {
 *                         "inventory_id": {
 *                           "type": "integer"
 *                         },
 *                         "mushroom_type_id": {
 *                           "type": "integer"
 *                         },
 *                         "mushroom_name": {
 *                           "type": "string"
 *                         },
 *                         "quantity": {
 *                           "type": "string",
 *                           "description": "PostgreSQL numeric serialized as a decimal string",
 *                           "example": "50"
 *                         },
 *                         "updated_at": {
 *                           "type": "string"
 *                         }
 *                       }
 *                     }
 *                   },
 *                   "pagination": {
 *                     "type": "object",
 *                     "properties": {
 *                       "page": {
 *                         "type": "integer"
 *                       },
 *                       "limit": {
 *                         "type": "integer"
 *                       },
 *                       "total": {
 *                         "type": "integer"
 *                       },
 *                       "totalPages": {
 *                         "type": "integer"
 *                       }
 *                     }
 *                   }
 *                 }
 *               }
 *             }
 *           }
 *         },
 *         "400": {
 *           "description": "Invalid input"
 *         },
 *         "401": {
 *           "description": "Authentication required"
 *         },
 *         "403": {
 *           "description": "Forbidden role"
 *         },
 *         "404": {
 *           "description": "Record not found"
 *         },
 *         "409": {
 *           "description": "Duplicate, inactive mushroom type, or deletion conflict"
 *         },
 *         "500": {
 *           "description": "Unexpected error"
 *         }
 *       },
 *       "parameters": [
 *         {
 *           "in": "query",
 *           "name": "page",
 *           "description": "page",
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1
 *           }
 *         },
 *         {
 *           "in": "query",
 *           "name": "limit",
 *           "description": "limit",
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1,
 *             "maximum": 100
 *           }
 *         },
 *         {
 *           "in": "query",
 *           "name": "mushroomTypeId",
 *           "description": "mushroomTypeId",
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1
 *           }
 *         },
 *         {
 *           "in": "query",
 *           "name": "search",
 *           "description": "search",
 *           "schema": {
 *             "type": "string"
 *           }
 *         }
 *       ]
 *     },
 *     "post": {
 *       "tags": [
 *         "Inventory"
 *       ],
 *       "summary": "Create inventory and IN transaction",
 *       "description": "Admin (role_id 1) and Farm Operator (role_id 2) only.",
 *       "security": [
 *         {
 *           "bearerAuth": []
 *         }
 *       ],
 *       "responses": {
 *         "201": {
 *           "description": "Success",
 *           "content": {
 *             "application/json": {
 *               "schema": {
 *                 "type": "object",
 *                 "properties": {
 *                   "data": {
 *                     "type": "object",
 *                     "properties": {
 *                       "inventory_id": {
 *                         "type": "integer"
 *                       },
 *                       "mushroom_type_id": {
 *                         "type": "integer"
 *                       },
 *                       "quantity": {
 *                         "type": "string",
 *                         "description": "PostgreSQL numeric serialized as a decimal string",
 *                         "example": "50"
 *                       },
 *                       "updated_at": {
 *                         "type": "string"
 *                       }
 *                     }
 *                   },
 *                   "message": {
 *                     "type": "string"
 *                   }
 *                 }
 *               }
 *             }
 *           }
 *         },
 *         "400": {
 *           "description": "Invalid input"
 *         },
 *         "401": {
 *           "description": "Authentication required"
 *         },
 *         "403": {
 *           "description": "Forbidden role"
 *         },
 *         "404": {
 *           "description": "Record not found"
 *         },
 *         "409": {
 *           "description": "Duplicate, inactive mushroom type, or deletion conflict"
 *         },
 *         "500": {
 *           "description": "Unexpected error"
 *         }
 *       },
 *       "parameters": [],
 *       "requestBody": {
 *         "required": true,
 *         "content": {
 *           "application/json": {
 *             "schema": {
 *               "type": "object",
 *               "additionalProperties": false,
 *               "required": [
 *                 "mushroomTypeId",
 *                 "quantity"
 *               ],
 *               "properties": {
 *                 "mushroomTypeId": {
 *                   "type": "integer",
 *                   "minimum": 1,
 *                   "example": 8
 *                 },
 *                 "quantity": {
 *                   "type": "number",
 *                   "minimum": 0,
 *                   "exclusiveMinimum": true,
 *                   "example": 50
 *                 },
 *                 "notes": {
 *                   "type": "string",
 *                   "example": "Physical stock count adjustment"
 *                 }
 *               }
 *             }
 *           }
 *         }
 *       }
 *     }
 *   },
 *   "/api/inventory/admin/exports": {
 *     "get": {
 *       "tags": [
 *         "Inventory"
 *       ],
 *       "summary": "List OUT transactions only",
 *       "description": "Admin (role_id 1) and Farm Operator (role_id 2) only.",
 *       "security": [
 *         {
 *           "bearerAuth": []
 *         }
 *       ],
 *       "responses": {
 *         "200": {
 *           "description": "Success",
 *           "content": {
 *             "application/json": {
 *               "schema": {
 *                 "type": "object",
 *                 "properties": {
 *                   "data": {
 *                     "type": "array",
 *                     "items": {
 *                       "type": "object",
 *                       "properties": {
 *                         "transaction_id": {
 *                           "type": "integer"
 *                         },
 *                         "inventory_id": {
 *                           "type": "integer"
 *                         },
 *                         "mushroom_type_id": {
 *                           "type": "integer"
 *                         },
 *                         "mushroom_name": {
 *                           "type": "string"
 *                         },
 *                         "transaction_type": {
 *                           "type": "string",
 *                           "enum": [
 *                             "OUT"
 *                           ]
 *                         },
 *                         "quantity": {
 *                           "type": "string",
 *                           "description": "PostgreSQL numeric serialized as a decimal string",
 *                           "example": "50"
 *                         },
 *                         "quantity_before": {
 *                           "type": "string",
 *                           "description": "PostgreSQL numeric serialized as a decimal string",
 *                           "example": "50"
 *                         },
 *                         "quantity_after": {
 *                           "type": "string",
 *                           "description": "PostgreSQL numeric serialized as a decimal string",
 *                           "example": "50"
 *                         },
 *                         "session_id": {
 *                           "type": "integer",
 *                           "nullable": true
 *                         },
 *                         "notes": {
 *                           "type": "string",
 *                           "nullable": true
 *                         },
 *                         "created_at": {
 *                           "type": "string"
 *                         }
 *                       }
 *                     }
 *                   },
 *                   "pagination": {
 *                     "type": "object",
 *                     "properties": {
 *                       "page": {
 *                         "type": "integer"
 *                       },
 *                       "limit": {
 *                         "type": "integer"
 *                       },
 *                       "total": {
 *                         "type": "integer"
 *                       },
 *                       "totalPages": {
 *                         "type": "integer"
 *                       }
 *                     }
 *                   }
 *                 }
 *               }
 *             }
 *           }
 *         },
 *         "400": {
 *           "description": "Invalid input"
 *         },
 *         "401": {
 *           "description": "Authentication required"
 *         },
 *         "403": {
 *           "description": "Forbidden role"
 *         },
 *         "404": {
 *           "description": "Record not found"
 *         },
 *         "409": {
 *           "description": "Duplicate, inactive mushroom type, or deletion conflict"
 *         },
 *         "500": {
 *           "description": "Unexpected error"
 *         }
 *       },
 *       "parameters": [
 *         {
 *           "in": "query",
 *           "name": "page",
 *           "description": "page",
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1
 *           }
 *         },
 *         {
 *           "in": "query",
 *           "name": "limit",
 *           "description": "limit",
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1,
 *             "maximum": 100
 *           }
 *         },
 *         {
 *           "in": "query",
 *           "name": "mushroomTypeId",
 *           "description": "mushroomTypeId",
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1
 *           }
 *         },
 *         {
 *           "in": "query",
 *           "name": "sessionId",
 *           "description": "sessionId",
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1
 *           }
 *         },
 *         {
 *           "in": "query",
 *           "name": "fromDate",
 *           "description": "Inclusive ISO date or timestamp. Date-only values mean midnight UTC.",
 *           "schema": {
 *             "type": "string"
 *           }
 *         },
 *         {
 *           "in": "query",
 *           "name": "toDate",
 *           "description": "Inclusive ISO date or timestamp. Date-only values mean midnight UTC.",
 *           "schema": {
 *             "type": "string"
 *           }
 *         }
 *       ]
 *     }
 *   },
 *   "/api/inventory/admin/{inventoryId}": {
 *     "patch": {
 *       "tags": [
 *         "Inventory"
 *       ],
 *       "summary": "Adjust inventory balance",
 *       "description": "Admin (role_id 1) and Farm Operator (role_id 2) only.",
 *       "security": [
 *         {
 *           "bearerAuth": []
 *         }
 *       ],
 *       "responses": {
 *         "200": {
 *           "description": "Success",
 *           "content": {
 *             "application/json": {
 *               "schema": {
 *                 "type": "object",
 *                 "properties": {
 *                   "data": {
 *                     "type": "object",
 *                     "properties": {
 *                       "inventory_id": {
 *                         "type": "integer"
 *                       },
 *                       "mushroom_type_id": {
 *                         "type": "integer"
 *                       },
 *                       "quantity": {
 *                         "type": "string",
 *                         "description": "PostgreSQL numeric serialized as a decimal string",
 *                         "example": "50"
 *                       },
 *                       "updated_at": {
 *                         "type": "string"
 *                       }
 *                     }
 *                   },
 *                   "message": {
 *                     "type": "string"
 *                   }
 *                 }
 *               }
 *             }
 *           }
 *         },
 *         "400": {
 *           "description": "Invalid input"
 *         },
 *         "401": {
 *           "description": "Authentication required"
 *         },
 *         "403": {
 *           "description": "Forbidden role"
 *         },
 *         "404": {
 *           "description": "Record not found"
 *         },
 *         "409": {
 *           "description": "Duplicate, inactive mushroom type, or deletion conflict"
 *         },
 *         "500": {
 *           "description": "Unexpected error"
 *         }
 *       },
 *       "parameters": [
 *         {
 *           "in": "path",
 *           "name": "inventoryId",
 *           "required": true,
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1
 *           }
 *         }
 *       ],
 *       "requestBody": {
 *         "required": true,
 *         "content": {
 *           "application/json": {
 *             "schema": {
 *               "type": "object",
 *               "additionalProperties": false,
 *               "required": [
 *                 "quantity",
 *                 "notes"
 *               ],
 *               "properties": {
 *                 "quantity": {
 *                   "type": "number",
 *                   "minimum": 0,
 *                   "example": 50
 *                 },
 *                 "notes": {
 *                   "type": "string",
 *                   "example": "Physical stock count adjustment"
 *                 }
 *               }
 *             }
 *           }
 *         }
 *       }
 *     },
 *     "delete": {
 *       "tags": [
 *         "Inventory"
 *       ],
 *       "summary": "Delete empty inventory without history",
 *       "description": "Admin (role_id 1) and Farm Operator (role_id 2) only.",
 *       "security": [
 *         {
 *           "bearerAuth": []
 *         }
 *       ],
 *       "responses": {
 *         "200": {
 *           "description": "Success",
 *           "content": {
 *             "application/json": {
 *               "schema": {
 *                 "type": "object",
 *                 "properties": {
 *                   "data": {
 *                     "type": "object",
 *                     "properties": {
 *                       "inventory_id": {
 *                         "type": "integer"
 *                       },
 *                       "mushroom_type_id": {
 *                         "type": "integer"
 *                       },
 *                       "quantity": {
 *                         "type": "string",
 *                         "description": "PostgreSQL numeric serialized as a decimal string",
 *                         "example": "50"
 *                       },
 *                       "updated_at": {
 *                         "type": "string"
 *                       }
 *                     }
 *                   },
 *                   "message": {
 *                     "type": "string"
 *                   }
 *                 }
 *               }
 *             }
 *           }
 *         },
 *         "400": {
 *           "description": "Invalid input"
 *         },
 *         "401": {
 *           "description": "Authentication required"
 *         },
 *         "403": {
 *           "description": "Forbidden role"
 *         },
 *         "404": {
 *           "description": "Record not found"
 *         },
 *         "409": {
 *           "description": "Duplicate, inactive mushroom type, or deletion conflict"
 *         },
 *         "500": {
 *           "description": "Unexpected error"
 *         }
 *       },
 *       "parameters": [
 *         {
 *           "in": "path",
 *           "name": "inventoryId",
 *           "required": true,
 *           "schema": {
 *             "type": "integer",
 *             "minimum": 1
 *           }
 *         }
 *       ]
 *     }
 *   }
 * }
 */
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/exports', controller.exports);
router.patch('/:inventoryId', controller.update);
router.delete('/:inventoryId', controller.remove);
module.exports = router;
