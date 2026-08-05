import { Router } from "express";

import { getGlMappings, patchGlMapping } from "./glMappingController.js";

export const glMappingRouter = Router();

glMappingRouter.get("/gl-mappings", getGlMappings);
glMappingRouter.patch("/gl-mappings/:id", patchGlMapping);
