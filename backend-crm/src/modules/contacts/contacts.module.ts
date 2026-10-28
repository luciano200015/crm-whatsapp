import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContactsEvents } from './application/contacts-events';
import { ContactsService } from './application/contacts.service';
import {
  ContactAgents,
  ContactFieldsStore,
  ContactsStore,
} from './application/ports';
import { PrismaContactAgents } from './infrastructure/prisma-contact-agents';
import {
  CONTACT_FIELD_MODEL,
  CONTACT_MODEL,
  ContactFieldSchema,
  ContactSchema,
  TAG_MODEL,
  TagSchema,
} from './infrastructure/contact.schemas';
import { MongoContactFieldsStore } from './infrastructure/mongo-contact-fields-store';
import { MongoContactsStore } from './infrastructure/mongo-contacts-store';
import {
  ContactFieldsController,
  ContactsController,
  TagsController,
} from './presentation/contacts.controller';

/** Contacts and tags, stored in MongoDB and always scoped to a workspace. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CONTACT_MODEL, schema: ContactSchema },
      { name: TAG_MODEL, schema: TagSchema },
      { name: CONTACT_FIELD_MODEL, schema: ContactFieldSchema },
    ]),
  ],
  controllers: [ContactsController, TagsController, ContactFieldsController],
  providers: [
    ContactsService,
    ContactsEvents,
    { provide: ContactsStore, useClass: MongoContactsStore },
    { provide: ContactFieldsStore, useClass: MongoContactFieldsStore },
    { provide: ContactAgents, useClass: PrismaContactAgents },
  ],
  exports: [ContactsService, ContactsStore, ContactsEvents],
})
export class ContactsModule {}
