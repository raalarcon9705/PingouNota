import React, { useState } from 'react';
import { type ServiceTemplate, serviceTemplateSchema } from '../../../src/domain/template';
import { renderTemplateDescription } from '../../../src/services/templates';

export interface TemplateEditorProps {
  initialTemplate?: ServiceTemplate | null;
  onSave: (template: ServiceTemplate) => Promise<void> | void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
  initialTemplate,
  onSave,
  onCancel,
  isLoading = false,
}) => {
  const [formData, setFormData] = useState({
    name: initialTemplate?.name || '',
    cnae: initialTemplate?.cnae || '',
    description:
      initialTemplate?.description ||
      'Prestação de serviços de desenvolvimento de software referente ao mês de {{mes}} de {{ano}}.',
    withholdTaxes: initialTemplate?.withholdTaxes || false,
    forwardingEmail: initialTemplate?.forwardingEmail || '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const templateId = initialTemplate?.id || crypto.randomUUID();
    const candidate = {
      id: templateId,
      name: formData.name.trim(),
      cnae: formData.cnae.trim(),
      description: formData.description.trim(),
      withholdTaxes: Boolean(formData.withholdTaxes),
      forwardingEmail: formData.forwardingEmail.trim()
        ? formData.forwardingEmail.trim()
        : null,
      createdAt: initialTemplate?.createdAt,
      updatedAt: initialTemplate?.updatedAt,
    };

    const parseResult = serviceTemplateSchema.safeParse(candidate);

    if (!parseResult.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parseResult.error.issues) {
        const fieldName = issue.path[0] as string;
        if (fieldName && !fieldErrors[fieldName]) {
          fieldErrors[fieldName] = issue.message;
        }
      }
      setErrors(fieldErrors);
      // Retain entered data when validation fails
      return;
    }

    try {
      setIsSubmitting(true);
      await onSave(parseResult.data);
    } catch (err) {
      console.error('[PingouNota] Falha ao salvar modelo:', err);
      setErrors({ form: 'Ocorreu um erro ao salvar o modelo de serviço.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Live preview of rendered description with current month & year
  const livePreview = renderTemplateDescription(
    formData.description,
    new Date().toISOString(),
  );

  return (
    <form
      className="form-container"
      onSubmit={handleSubmit}
      noValidate
      data-testid="template-editor-form"
    >
      <header className="form-header">
        <h3>{initialTemplate ? 'Editar Modelo' : 'Novo Modelo de Serviço'}</h3>
        <p className="form-subtitle">
          Configure as informações padrão para geração das notas fiscais.
        </p>
      </header>

      {errors.form && (
        <div className="form-error-banner" role="alert">
          {errors.form}
        </div>
      )}

      <div className="form-group">
        <label htmlFor="template-name" className="form-label">
          Nome do Modelo <span className="required-indicator">*</span>
        </label>
        <input
          id="template-name"
          name="name"
          type="text"
          className={`form-input ${errors.name ? 'input-error' : ''}`}
          placeholder="Ex: Serviços de TI - Desenvolvimento"
          value={formData.name}
          onChange={handleChange}
          disabled={isLoading || isSubmitting}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'template-name-error' : undefined}
          required
        />
        {errors.name && (
          <span id="template-name-error" className="form-error-message">
            {errors.name}
          </span>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="template-cnae" className="form-label">
          Código CNAE <span className="required-indicator">*</span>
        </label>
        <input
          id="template-cnae"
          name="cnae"
          type="text"
          className={`form-input ${errors.cnae ? 'input-error' : ''}`}
          placeholder="Ex: 6201-5/01"
          value={formData.cnae}
          onChange={handleChange}
          disabled={isLoading || isSubmitting}
          aria-invalid={Boolean(errors.cnae)}
          aria-describedby={errors.cnae ? 'template-cnae-error' : undefined}
          required
        />
        {errors.cnae && (
          <span id="template-cnae-error" className="form-error-message">
            {errors.cnae}
          </span>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="template-description" className="form-label">
          Descrição do Serviço <span className="required-indicator">*</span>
        </label>
        <textarea
          id="template-description"
          name="description"
          rows={3}
          className={`form-textarea ${errors.description ? 'input-error' : ''}`}
          placeholder="Use {{mes}} para o mês e {{ano}} para o ano."
          value={formData.description}
          onChange={handleChange}
          disabled={isLoading || isSubmitting}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={
            errors.description
              ? 'template-desc-error'
              : 'template-desc-hint'
          }
          required
        />
        <span id="template-desc-hint" className="form-hint">
          Variáveis disponíveis: <code>{'{{mes}}'}</code> (ex: novembro),{' '}
          <code>{'{{mes_numero}}'}</code> (ex: 11), <code>{'{{ano}}'}</code> (ex: 2026).
        </span>
        {errors.description && (
          <span id="template-desc-error" className="form-error-message">
            {errors.description}
          </span>
        )}

        {formData.description && (
          <div className="template-preview-box">
            <span className="preview-label">Pré-visualização da descrição:</span>
            <p className="preview-text">{livePreview}</p>
          </div>
        )}
      </div>

      <div className="form-group-checkbox">
        <input
          id="template-withhold-taxes"
          name="withholdTaxes"
          type="checkbox"
          className="form-checkbox"
          checked={formData.withholdTaxes}
          onChange={handleChange}
          disabled={isLoading || isSubmitting}
        />
        <label
          htmlFor="template-withhold-taxes"
          className="form-checkbox-label"
        >
          Reter impostos na fonte (Withhold taxes)
        </label>
      </div>

      <div className="form-group">
        <label htmlFor="template-forwarding-email" className="form-label">
          E-mail de Encaminhamento (opcional)
        </label>
        <input
          id="template-forwarding-email"
          name="forwardingEmail"
          type="email"
          className={`form-input ${errors.forwardingEmail ? 'input-error' : ''}`}
          placeholder="Ex: financeiro@empresa.com"
          value={formData.forwardingEmail}
          onChange={handleChange}
          disabled={isLoading || isSubmitting}
          aria-invalid={Boolean(errors.forwardingEmail)}
          aria-describedby={
            errors.forwardingEmail ? 'template-email-error' : undefined
          }
        />
        {errors.forwardingEmail && (
          <span id="template-email-error" className="form-error-message">
            {errors.forwardingEmail}
          </span>
        )}
      </div>

      <footer className="form-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={isLoading || isSubmitting}
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={isLoading || isSubmitting}
        >
          {isSubmitting ? 'Salvando...' : 'Salvar Modelo'}
        </button>
      </footer>
    </form>
  );
};

export default TemplateEditor;
