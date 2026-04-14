import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { addBookmark, removeBookmark, listBookmarks } from '../services/bookmark.service';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/v1/bookmarks — list bookmarks (cursor-paginated)
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined;

    const result = await listBookmarks(userId, cursor, pageSize);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/bookmarks/:trendItemId — add bookmark
router.post('/:trendItemId', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { trendItemId } = req.params;

    await addBookmark(userId, trendItemId);
    res.status(201).json({ message: 'Bookmarked' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/bookmarks/:trendItemId — remove bookmark
router.delete('/:trendItemId', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { trendItemId } = req.params;

    await removeBookmark(userId, trendItemId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
