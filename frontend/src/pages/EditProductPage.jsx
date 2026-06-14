import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getProductById, updateProduct } from '../services/product.service';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import ProductImageAngleEditor from '../components/shared/ProductImageAngleEditor';

const EditProductPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    category: '',
    brandName: '',
    images: [''],
    imageAngles: {},
    imageHints: [],
    gradingInstructions: '',
  });

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const response = await getProductById(id);
        if (response.success) {
          const product = response.data;
          setFormData({
            title: product.title || '',
            description: product.description || '',
            price: product.price !== undefined ? product.price.toString() : '',
            category: product.category || '',
            brandName: product.brandName || '',
            images: product.images && product.images.length > 0 ? product.images : [''],
            imageAngles: product.imageAngles && typeof product.imageAngles === 'object' ? product.imageAngles : {},
            imageHints: Array.isArray(product.imageHints) ? product.imageHints : [],
            gradingInstructions: product.gradingInstructions || '',
          });
        } else {
          setError('Failed to fetch product details.');
        }
      } catch (err) {
        console.error(err);
        setError('Error loading product details. Make sure you are authorized.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchProduct();
  }, [id]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    // Basic client validation
    if (!formData.title || !formData.description || formData.price === '' || !formData.category) {
      setError('All fields are required.');
      setIsSubmitting(false);
      return;
    }

    if (isNaN(Number(formData.price)) || Number(formData.price) < 0) {
      setError('Price must be a valid positive number.');
      setIsSubmitting(false);
      return;
    }

    try {
      const images = formData.images.filter(url => url.trim() !== '');
      const response = await updateProduct(id, {
        ...formData,
        price: Number(formData.price),
        images,
      });

      if (response.success) {
        navigate('/seller/dashboard');
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Failed to update product. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
          <p className="text-sm text-zinc-500">Loading product details...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8 font-sans flex justify-center items-center">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-3xl p-8 md:p-12 shadow-2xl relative overflow-hidden"
      >
        {/* Decorative background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[150%] h-[150px] bg-blue-500/10 blur-[100px] rounded-[100%] pointer-events-none" />

        <button 
          onClick={() => navigate('/seller/dashboard')}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-8 relative z-10"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <div className="mb-10 relative z-10">
          <h1 className="text-4xl font-bold tracking-tight mb-2">Edit Listing</h1>
          <p className="text-zinc-400">Modify the product details below.</p>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-sm"
          >
            {error}
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-zinc-300 mb-2">
              Product Title
            </label>
            <input
              type="text"
              id="title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="e.g. Premium Wireless Headphones"
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
            />
          </div>

          <div>
            <label htmlFor="price" className="block text-sm font-medium text-zinc-300 mb-2">
              Price (₹)
            </label>
            <input
              type="number"
              id="price"
              name="price"
              step="0.01"
              value={formData.price}
              onChange={handleChange}
              placeholder="0.00"
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
            />
          </div>

          <div>
            <label htmlFor="category" className="block text-sm font-medium text-zinc-300 mb-2">
              Category
            </label>
            <select
              id="category"
              name="category"
              value={formData.category}
              onChange={handleChange}
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
            >
              <option value="">Select a category...</option>
              <option value="Electronics">Electronics</option>
              <option value="Clothing">Clothing</option>
              <option value="Home & Garden">Home &amp; Garden</option>
              <option value="Sports">Sports</option>
              <option value="Toys">Toys</option>
              <option value="Books">Books</option>
              <option value="Automotive">Automotive</option>
              <option value="Health & Beauty">Health &amp; Beauty</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label htmlFor="brandName" className="block text-sm font-medium text-zinc-300 mb-2">
              Brand Name <span className="text-zinc-500">(optional)</span>
            </label>
            <input
              type="text"
              id="brandName"
              name="brandName"
              value={formData.brandName}
              onChange={handleChange}
              placeholder="e.g. Nike, Apple, Samsung"
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
            />
            <p className="text-xs text-zinc-600 mt-1">
              Type any brand name freely. The AI will cross-reference this against registered brands.
            </p>
          </div>

          <ProductImageAngleEditor
            images={formData.images}
            angles={formData.imageAngles}
            hints={formData.imageHints}
            setImages={(images) => setFormData((prev) => ({ ...prev, images }))}
            setAngles={(imageAngles) => setFormData((prev) => ({ ...prev, imageAngles }))}
            setHints={(imageHints) => setFormData((prev) => ({ ...prev, imageHints }))}
          />

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-zinc-300 mb-2">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              value={formData.description}
              onChange={handleChange}
              placeholder="Describe your product in detail..."
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all resize-none"
            />
          </div>

          <div>
            <label htmlFor="gradingInstructions" className="block text-sm font-medium text-zinc-300 mb-2">
              AI Grading Instructions <span className="text-zinc-500">(optional)</span>
            </label>
            <textarea
              id="gradingInstructions"
              name="gradingInstructions"
              rows={4}
              value={formData.gradingInstructions}
              onChange={handleChange}
              placeholder="Product-specific guidance for the AI grader when a buyer returns or resells this item. e.g. 'Check the hinge for cracks — this model is prone to them. The charging cable must be present for Grade A. Counterfeits have a misaligned logo on the back.'"
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-all resize-y"
            />
            <p className="text-xs text-zinc-600 mt-1">
              Advisory only — refines, never overrides, the platform's grading rubric. Layered after
              the base and category prompts when this product is graded.
            </p>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 bg-white text-black font-semibold py-4 rounded-xl hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Saving Changes...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default EditProductPage;
