import { withFilter } from 'apollo-server'

import { pubSub } from '../../utils/apollo-server'
import { NOTIFICATION_CREATED_OR_DELETED } from '../../constants/Subscriptions'

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const Query = {
  /**
   * Gets notifications for specific user
   *
   * @param {string} userId
   * @param {int} skip how many notifications to skip
   * @param {int} limit how many notifications to limit
   */
  getUserNotifications: async (
    root,
    { userId, skip, limit },
    { Notification },
  ) => {
    const query = { userId: parseInt(userId) }
    const count = await prisma.notification.count({ where: query })
    const notifications = await prisma.notification.findMany({
      where: query,
      include: {
        author: true,
        user: true,
        follow: true,
        comment: {
          include: {
            post: true,
          },
        },
        like: {
          include: {
            post: true,
          },
        },
      },
      skip: skip,
      first: limit,
      orderBy: {
        createdAt: 'desc',
      },
    })

    return { notifications, count }
  },
}

const Mutation = {
  /**
   * Creates a new notification for user
   *
   * @param {string} userId
   * @param {string} authorId
   * @param {string} postId
   * @param {string} notificationType
   * @param {string} notificationTypeId
   */
  createNotification: async (
    root,
    {
      input: { userId, authorId, postId, notificationType, notificationTypeId },
    },
    { Notification, User },
  ) => {
    const createNotification = await prisma.notification.create({
      data: {
        author: {
          connect: { id: parseInt(authorId) },
        },
        user: {
          connect: { id: parseInt(userId) },
        },
      },
    })

    if (notificationType.toLowerCase() === 'follow') {
      await prisma.notification.update({
        where: { id: createNotification.id },
        data: {
          follow: {
            connect: { id: parseInt(notificationTypeId) },
          },
        },
      })
    }

    if (notificationType.toLowerCase() === 'comment') {
      await prisma.notification.update({
        where: { id: createNotification.id },
        data: {
          comment: {
            connect: { id: parseInt(notificationTypeId) },
          },
          post: {
            connect: { id: parseInt(postId) },
          },
        },
      })
    }

    if (notificationType.toLowerCase() === 'like') {
      await prisma.notification.update({
        where: { id: createNotification.id },
        data: {
          like: {
            connect: { id: parseInt(notificationTypeId) },
          },
          post: {
            connect: { id: parseInt(postId) },
          },
        },
      })
    }

    const newNotification = await prisma.notification.findOne({
      where: { id: createNotification.id },
      include: {
        author: true,
        follow: true,
        comment: {
          include: {
            post: true,
          },
        },
        like: {
          include: {
            post: true,
          },
        },
      },
    })

    pubSub.publish(NOTIFICATION_CREATED_OR_DELETED, {
      notificationCreatedOrDeleted: {
        operation: 'CREATE',
        notification: newNotification,
      },
    })

    return newNotification
  },
  /**
   * Deletes a notification
   *
   * @param {string} id
   */
  deleteNotification: async (
    root,
    { input: { id } },
    { Notification, User },
  ) => {
    const notification = await prisma.notification.delete({
      where: { id: parseInt(id) },
      include: {
        author: true,
        follow: true,
        comment: {
          include: {
            post: true,
          },
        },
        like: {
          include: {
            post: true,
          },
        },
      },
    })
    pubSub.publish(NOTIFICATION_CREATED_OR_DELETED, {
      notificationCreatedOrDeleted: {
        operation: 'DELETE',
        notification,
      },
    })

    return notification
  },
  /**
   * Updates notification seen values for user
   *
   * @param {string} userId
   */
  updateNotificationSeen: async (
    root,
    { input: { userId } },
    { Notification },
  ) => {
    try {
      await prisma.notification.updateMany({
        where: {
          userId: parseInt(userId),
          seen: false
        },
        data: {
          seen: true,
        }
      })

      return true
    } catch (e) {
      return false
    }
  },
}

const Subscription = {
  /**
   * Subscribes to notification created or deleted event
   */
  notificationCreatedOrDeleted: {
    subscribe: withFilter(
      () => pubSub.asyncIterator(NOTIFICATION_CREATED_OR_DELETED),
      (payload, variables, { authUser }) => {
        const userId = payload.notificationCreatedOrDeleted.notification.user.toString()

        return authUser && authUser.id === parseInt(userId)
      },
    ),
  },
}

export default { Query, Mutation, Subscription }
