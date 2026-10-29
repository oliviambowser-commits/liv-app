import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catalogRouter from "./catalog";
import askRouter from "./ask";
import identifyRouter from "./identify";

const router: IRouter = Router();

router.use(healthRouter);
router.use(catalogRouter);
router.use(askRouter);
router.use(identifyRouter);

export default router;
