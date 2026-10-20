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
  tagNotFound: () =>
    new NotFoundException({ message: 'Tag not found', code: 'TAG_NOT_FOUND' }),
  tagNameTaken: () =>
    new ConflictException({
      message: 'A tag with this name already exists',
      code: 'TAG_NAME_TAKEN',
    }),
};
