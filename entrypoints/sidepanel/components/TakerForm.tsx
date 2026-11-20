import React, { useState } from 'react';
import {
  type TakerProfile,
  takerProfileSchema,
} from '../../../src/domain/taker';

export interface TakerFormProps {
  initialTaker?: TakerProfile | null;
  onSave: (taker: TakerProfile) => Promise<void> | void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function formatCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 11) {
    // CPF formatting: 000.000.000-00
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
      .slice(0, 14);
  }
  // CNPJ formatting: 00.000.000/0000-00
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
    .slice(0, 18);
}

export function formatCep(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.replace(/^(\d{5})(\d)/, '$1-$2').slice(0, 9);
}

export function isBrazilianCountry(
  countryStr: string | null | undefined,
): boolean {
  if (!countryStr) return true;
  const normalized = countryStr.trim().toLowerCase();
  return (
    normalized === 'brasil' ||
    normalized === 'brazil' ||
    normalized === 'br'
  );
}

export const TakerForm: React.FC<TakerFormProps> = ({
  initialTaker,
  onSave,
  onCancel,
  isLoading = false,
}) => {
  const [formData, setFormData] = useState({
    name: initialTaker?.name || '',
    document: initialTaker?.document || '',
    externalId: initialTaker?.externalId || '',
    email: initialTaker?.email || '',
    phone: initialTaker?.phone || '',
    line1: initialTaker?.address?.line1 || '',
    number: initialTaker?.address?.number || '',
    neighborhood: initialTaker?.address?.neighborhood || '',
    city: initialTaker?.address?.city || '',
    state: initialTaker?.address?.state || '',
    postalCode: initialTaker?.address?.postalCode || '',
    country: initialTaker?.address?.country || 'Brasil',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    let formattedValue = value;

    if (name === 'document') {
      formattedValue = formatCpfCnpj(value);
    } else if (name === 'postalCode') {
      formattedValue = formatCep(value);
    } else if (name === 'state') {
      formattedValue = value.toUpperCase().slice(0, 2);
    }

    setFormData((prev) => ({
      ...prev,
      [name]: formattedValue,
    }));

    // Clear error for field
    const errorKey = name.startsWith('line1') || name.startsWith('city') || name.startsWith('state') || name.startsWith('postalCode')
      ? `address.${name}`
      : name;

    if (errors[errorKey] || errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[errorKey];
        delete next[name];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const takerId = initialTaker?.id || crypto.randomUUID();

    const candidate: TakerProfile = {
      id: takerId,
      name: formData.name.trim(),
      document: formData.document.trim() ? formData.document.trim() : null,
      externalId: formData.externalId.trim() ? formData.externalId.trim() : null,
      email: formData.email.trim() ? formData.email.trim() : null,
      phone: formData.phone.trim() ? formData.phone.trim() : null,
      address: {
        line1: formData.line1.trim(),
        number: formData.number.trim() ? formData.number.trim() : null,
        neighborhood: formData.neighborhood.trim()
          ? formData.neighborhood.trim()
          : null,
        city: formData.city.trim(),
        state: formData.state.trim().toUpperCase(),
        postalCode: formData.postalCode.trim(),
        country: formData.country.trim() || 'BR',
      },
      createdAt: initialTaker?.createdAt,
      updatedAt: initialTaker?.updatedAt,
    };

    const parseResult = takerProfileSchema.safeParse(candidate);
    const isBrazilian = isBrazilianCountry(formData.country);
    const fieldErrors: Record<string, string> = {};

    if (isBrazilian && !formData.document.trim()) {
      fieldErrors.document =
        'CPF ou CNPJ é obrigatório para tomadores no Brasil.';
    }

    if (!parseResult.success) {
      for (const issue of parseResult.error.issues) {
        const key = issue.path.join('.');
        if (!fieldErrors[key]) {
          fieldErrors[key] = issue.message;
        }
      }
    }

    if (Object.keys(fieldErrors).length > 0 || !parseResult.success) {
      setErrors(fieldErrors);
      // Retain entered data when validation fails
      return;
    }

    try {
      setIsSubmitting(true);
      await onSave(parseResult.data);
    } catch (err) {
      console.error('[PingouNota] Falha ao salvar tomador:', err);
      setErrors({ form: 'Ocorreu um erro ao salvar o tomador de serviço.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBrazilian = isBrazilianCountry(formData.country);

  return (
    <form
      className="form-container"
      onSubmit={handleSubmit}
      noValidate
      data-testid="taker-form"
    >
      <header className="form-header">
        <h3>{initialTaker ? 'Editar Tomador' : 'Novo Tomador de Serviço'}</h3>
        <p className="form-subtitle">
          Cadastre o tomador para emissão de notas fiscais (Adaflow).
        </p>
      </header>

      {errors.form && (
        <div className="form-error-banner" role="alert">
          {errors.form}
        </div>
      )}

      {/* Identificação */}
      <fieldset className="form-fieldset">
        <legend className="form-legend">Dados de Identificação</legend>

        <div className="form-group">
          <label htmlFor="taker-name" className="form-label">
            Nome / Razão Social <span className="required-indicator">*</span>
          </label>
          <input
            id="taker-name"
            name="name"
            type="text"
            className={`form-input ${errors.name ? 'input-error' : ''}`}
            placeholder="Ex: Empresa Exemplo Ltda"
            value={formData.name}
            onChange={handleInputChange}
            disabled={isLoading || isSubmitting}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'taker-name-error' : undefined}
            required
          />
          {errors.name && (
            <span id="taker-name-error" className="form-error-message">
              {errors.name}
            </span>
          )}
        </div>

        <div className="form-row">
          <div className="form-group flex-1">
            <label htmlFor="taker-document" className="form-label">
              CPF ou CNPJ {isBrazilian && <span className="required-indicator">*</span>}
            </label>
            <input
              id="taker-document"
              name="document"
              type="text"
              className={`form-input ${errors.document ? 'input-error' : ''}`}
              placeholder="000.000.000-00 ou 00.000.000/0000-00"
              value={formData.document}
              onChange={handleInputChange}
              disabled={isLoading || isSubmitting}
              aria-invalid={Boolean(errors.document)}
              aria-describedby={
                errors.document ? 'taker-document-error' : undefined
              }
            />
            {errors.document && (
              <span id="taker-document-error" className="form-error-message">
                {errors.document}
              </span>
            )}
          </div>

          <div className="form-group flex-1">
            <label htmlFor="taker-external-id" className="form-label">
              ID Externo (Opcional)
            </label>
            <input
              id="taker-external-id"
              name="externalId"
              type="text"
              className="form-input"
              placeholder="Ex: CLI-12345"
              value={formData.externalId}
              onChange={handleInputChange}
              disabled={isLoading || isSubmitting}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group flex-1">
            <label htmlFor="taker-email" className="form-label">
              E-mail
            </label>
            <input
              id="taker-email"
              name="email"
              type="email"
              className={`form-input ${errors.email ? 'input-error' : ''}`}
              placeholder="Ex: financeiro@tomador.com.br"
              value={formData.email}
              onChange={handleInputChange}
              disabled={isLoading || isSubmitting}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'taker-email-error' : undefined}
            />
            {errors.email && (
              <span id="taker-email-error" className="form-error-message">
                {errors.email}
              </span>
            )}
          </div>

          <div className="form-group flex-1">
            <label htmlFor="taker-phone" className="form-label">
              Telefone
            </label>
            <input
              id="taker-phone"
              name="phone"
              type="tel"
              className={`form-input ${errors.phone ? 'input-error' : ''}`}
              placeholder="Ex: (11) 98765-4321"
              value={formData.phone}
              onChange={handleInputChange}
              disabled={isLoading || isSubmitting}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? 'taker-phone-error' : undefined}
            />
            {errors.phone && (
              <span id="taker-phone-error" className="form-error-message">
                {errors.phone}
              </span>
            )}
          </div>
        </div>
      </fieldset>

      {/* Endereço */}
      <fieldset className="form-fieldset">
        <legend className="form-legend">Endereço</legend>

        <div className="form-row">
          <div className="form-group flex-3">
            <label htmlFor="taker-line1" className="form-label">
              Logradouro (Rua, Av.) <span className="required-indicator">*</span>
            </label>
            <input
              id="taker-line1"
              name="line1"
              type="text"
              className={`form-input ${
                errors['address.line1'] ? 'input-error' : ''
              }`}
              placeholder="Ex: Av. Paulista"
              value={formData.line1}
              onChange={handleInputChange}
              disabled={isLoading || isSubmitting}
              aria-invalid={Boolean(errors['address.line1'])}
              aria-describedby={
                errors['address.line1'] ? 'taker-line1-error' : undefined
              }
              required
            />
            {errors['address.line1'] && (
              <span id="taker-line1-error" className="form-error-message">
                {errors['address.line1']}
              </span>
            )}
          </div>

          <div className="form-group flex-1">
            <label htmlFor="taker-number" className="form-label">
              Número
            </label>
            <input
              id="taker-number"
              name="number"
              type="text"
              className="form-input"
              placeholder="Ex: 1000"
              value={formData.number}
              onChange={handleInputChange}
              disabled={isLoading || isSubmitting}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group flex-2">
            <label htmlFor="taker-neighborhood" className="form-label">
              Bairro
            </label>
            <input
              id="taker-neighborhood"
              name="neighborhood"
              type="text"
              className="form-input"
              placeholder="Ex: Bela Vista"
              value={formData.neighborhood}
              onChange={handleInputChange}
              disabled={isLoading || isSubmitting}
            />
          </div>

          <div className="form-group flex-2">
            <label htmlFor="taker-city" className="form-label">
              Cidade <span className="required-indicator">*</span>
            </label>
            <input
              id="taker-city"
              name="city"
              type="text"
              className={`form-input ${
                errors['address.city'] ? 'input-error' : ''
              }`}
              placeholder="Ex: São Paulo"
              value={formData.city}
              onChange={handleInputChange}
              disabled={isLoading || isSubmitting}
              aria-invalid={Boolean(errors['address.city'])}
              aria-describedby={
                errors['address.city'] ? 'taker-city-error' : undefined
              }
              required
            />
            {errors['address.city'] && (
              <span id="taker-city-error" className="form-error-message">
                {errors['address.city']}
              </span>
            )}
          </div>

          <div className="form-group flex-1">
            <label htmlFor="taker-state" className="form-label">
              UF <span className="required-indicator">*</span>
            </label>
            <input
              id="taker-state"
              name="state"
              type="text"
              maxLength={2}
              className={`form-input uppercase ${
                errors['address.state'] ? 'input-error' : ''
              }`}
              placeholder="SP"
              value={formData.state}
              onChange={handleInputChange}
              disabled={isLoading || isSubmitting}
              aria-invalid={Boolean(errors['address.state'])}
              aria-describedby={
                errors['address.state'] ? 'taker-state-error' : undefined
              }
              required
            />
            {errors['address.state'] && (
              <span id="taker-state-error" className="form-error-message">
                {errors['address.state']}
              </span>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group flex-1">
            <label htmlFor="taker-postalCode" className="form-label">
              CEP <span className="required-indicator">*</span>
            </label>
            <input
              id="taker-postalCode"
              name="postalCode"
              type="text"
              className={`form-input ${
                errors['address.postalCode'] ? 'input-error' : ''
              }`}
              placeholder="00000-000"
              value={formData.postalCode}
              onChange={handleInputChange}
              disabled={isLoading || isSubmitting}
              aria-invalid={Boolean(errors['address.postalCode'])}
              aria-describedby={
                errors['address.postalCode']
                  ? 'taker-postalCode-error'
                  : undefined
              }
              required
            />
            {errors['address.postalCode'] && (
              <span id="taker-postalCode-error" className="form-error-message">
                {errors['address.postalCode']}
              </span>
            )}
          </div>

          <div className="form-group flex-1">
            <label htmlFor="taker-country" className="form-label">
              País
            </label>
            <input
              id="taker-country"
              name="country"
              type="text"
              className="form-input"
              value={formData.country}
              onChange={handleInputChange}
              disabled={isLoading || isSubmitting}
            />
          </div>
        </div>
      </fieldset>

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
          {isSubmitting ? 'Salvando...' : 'Salvar Tomador'}
        </button>
      </footer>
    </form>
  );
};

export default TakerForm;
