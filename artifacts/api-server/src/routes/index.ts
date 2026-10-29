import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catalogRouter from "./catalog";
import askRouter from "./ask";
import identifyRouter from "./identify";
import discoverRouter from "./discover";

const router: IRouter = Router();

router.use(healthRouter);
router.use(catalogRouter);
router.use(askRouter);
router.use(identifyRouter);
router.use(discoverRouter);

export default router;
