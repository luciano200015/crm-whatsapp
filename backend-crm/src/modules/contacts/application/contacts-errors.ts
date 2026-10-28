import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/** Stable `code`s so clients can show their own localized message. */
export const ContactsErrors = {
  contactNotFound: () =>
    new NotFoundException({
      message: 'Contact not found',
      code: 'CONTACT_NOT_FOUND',
    }),
  phoneTaken: () =>
    new ConflictException({
      message: 'A contact with this phone number already exists',
      code: 'CONTACT_PHONE_TAKEN',
    }),
  invalidPhone: () =>
    new BadRequestException({
      message:
        'Enter the phone number in international format, e.g. +59171234567',
      code: 'INVALID_PHONE',
    }),
  agentNotFound: () =>
    new NotFoundException({
      message:
        'The regular agent must be an active member who attends that line',
      code: 'CONTACT_AGENT_NOT_FOUND',
    }),
  lineNotFound: () =>
    new NotFoundException({
      message: 'WhatsApp line not found',
      code: 'CONTACT_LINE_NOT_FOUND',
    }),
  fieldNotFound: () =>
    new NotFoundException({
      message: 'Custom field not found',
      code: 'CONTACT_FIELD_NOT_FOUND',
    }),
  fieldTaken: () =>
    new ConflictException({
      message: 'A custom field with this name already exists',
      code: 'CONTACT_FIELD_TAKEN',
    }),
  fieldInvalidLabel: () =>
    new BadRequestException({
      message: 'The field name needs letters or digits',
      code: 'CONTACT_FIELD_INVALID_LABEL',
    }),
  fieldOptionsRequired: () =>
    new BadRequestException({
      message: 'A list field needs at least one option',
      code: 'CONTACT_FIELD_OPTIONS_REQUIRED',
    }),
  fieldsLimit: (max: number) =>
    new ConflictException({
      message: `A workspace can have up to ${max} custom fields`,
      code: 'CONTACT_FIELDS_LIMIT',
    }),
  fieldInvalidValue: (label: string) =>
    new BadRequestException({
      message: `Invalid value for «${label}»`,
      code: 'CONTACT_FIELD_INVALID_VALUE',
    }),
  confirmationRequired: () =>
    new BadRequestException({
      message: 'Type ELIMINAR to confirm',
      code: 'CONFIRMATION_REQUIRED',
    }),
  tagNotFound: () =>
    new NotFoundException({ message: 'Tag not found', code: 'TAG_NOT_FOUND' }),
  tagNameTaken: () =>
    new ConflictException({
      message: 'A tag with this name already exists',
      code: 'TAG_NAME_TAKEN',
    }),
};
