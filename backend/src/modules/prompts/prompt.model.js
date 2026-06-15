const mongoose = require('mongoose');

/**
 * PromptConfig — admin-editable prompt overlays for the AI grading pipeline (v2.34).
 *
 * Composition order at grading time (resolved in grading.service):
 *   base (scope='base')  ->  category (scope='category', key=<bundle>)  ->  seller-custom
 *
 * In addition to the composed prompt overlays, whole task TEMPLATES sent to the
 * Grading_LLM are editable (scope='template'): the Pass-1 form generator, the Pass-2
 * grade synthesizer, the evidence inspector, and the montage prompt.
 *
 * A row is the source of truth that OVERRIDES the static prompt files shipped with the
 * ML service. When no row exists, the ML service falls back to its bundled file.
 */
const promptConfigSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      enum: ['base', 'category', 'template'],
      required: true,
      index: true,
    },
    // 'base' for the base prompt; the category bundle key (e.g. 'electronics',
    // 'consumables') for category overlays; the template key (e.g. 'pass1_form',
    // 'pass2_synthesis', 'evidence_inspection', 'montage') for task templates.
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    // Human-friendly label for the dashboard.
    label: {
      type: String,
      trim: true,
      default: '',
    },
    content: {
      type: String,
      default: '',
    },
    // Bump on every save so the Evidence_Bundle / logs can record which prompt
    // version produced a grade.
    version: {
      type: Number,
      default: 1,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

promptConfigSchema.index({ scope: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('PromptConfig', promptConfigSchema);
