import { Router } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service';
import { registerSchema, loginSchema, refreshSchema } from '../schemas/auth.schemas';

const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const tokens = await authService.register(body.email, body.password);
    res.status(201).json(tokens);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const tokens = await authService.login(body.email, body.password);
    res.json(tokens);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const body = refreshSchema.parse(req.body);
    const tokens = await authService.refresh(body.refreshToken);
    res.json(tokens);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    // logout requires auth — for now accept userId from body (auth middleware added in task 6)
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId required' });
    await authService.logout(userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
