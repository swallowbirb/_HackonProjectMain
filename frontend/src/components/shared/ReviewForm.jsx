import { useState } from 'react';
import { motion } from 'framer-motion';
import StarRating from './StarRating';
import { Loader2, Send } from 'lucide-react';

export default function ReviewForm({ productId, onSuccess }) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rating === 0) {
      setError('Please select a star rating.');
      return;
    }
    if (!text.trim()) {
      setError('Please write a review.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const { createReview } = await import('../../services/review.service');
      const response = await createReview({ productId, rating, title, text });
      if (response.success) {
        setRating(0);
        setTitle('');
        setText('');
        onSuccess && onSuccess(response.data);
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to submit review. Please try again.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-gray-200 rounded-md p-5 space-y-4"
      >
        <h3 className="text-base font-bold text-gray-900">Write a Customer Review</h3>

        {/* Star picker */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">Overall Rating</label>
          <StarRating rating={rating} interactive onChange={setRating} size="lg" />
        </div>

        {/* Title */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">Review Title (optional)</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's most important to know?"
            maxLength={120}
            className="w-full bg-white text-gray-900 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF9900] focus:ring-1 focus:ring-[#FF9900] transition-all select-text"
          />
        </div>

        {/* Body */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">Your Review</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What did you like or dislike? What did you use this product for?"
            rows={4}
            maxLength={5000}
            className="w-full bg-white text-gray-900 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF9900] focus:ring-1 focus:ring-[#FF9900] transition-all resize-none select-text"
          />
          <p className="text-xs text-gray-400 mt-0.5">{text.length}/5000</p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded">{error}</p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="amz-btn-primary px-6 py-2 rounded text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {isSubmitting ? 'Submitting...' : 'Submit Review'}
        </button>
      </form>
    </motion.div>
  );
}
