import { Router } from "express";

import { getGlMappings, putGlMappings } from "./glMappingController.js";

export const glMappingRouter = Router();

glMappingRouter.get("/gl-mappings", getGlMappings);
glMappingRouter.put("/gl-mappings", putGlMappings);
