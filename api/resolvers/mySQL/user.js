import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { withFilter } from 'apollo-server'

import { uploadToCloudinary } from '../../utils/cloudinary'
import { generateToken } from '../../utils/generate-token'
import { sendEmail } from '../../utils/email'
import { pubSub } from '../../utils/apollo-server'

import { IS_USER_ONLINE } from '../../constants/Subscriptions'

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const AUTH_TOKEN_EXPIRY = '1y'
const RESET_PASSWORD_TOKEN_EXPIRY = 3600000

const Query = {
  /**
   * Gets the currently logged in user
   */
  getAuthUser: async (root, args, { authUser, Message, User }) => {
    if (!authUser) return null

    // If user is authenticated, update it's isOnline field to true
    let user = await prisma.user.update({
      where: {
        email: authUser.email,
      },
      data: {
        isOnline: true,
      },
      include: {
        posts: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        likes: true,
        followers: {
          select: {
            id: true,
            followerId: true,
          },
        },
        following: {
          select: {
            id: true,
            userId: true,
          },
        },
        notifications: {
          where: {
            seen: false,
          },
          include: {
            author: true,
            follow: true,
            like: {
              include: {
                post: true,
              },
            },
            comment: {
              include: {
                post: true,
              },
            },
          },
        },
      },
    })

    user.newNotifications = user.notifications

    // Find unseen messages
    const lastUnseenMessages = await prisma.message.findMany({
      where: {
        receiverId: user.id,
        seen: false,
      },
      include: {
        sender: true,
      },
    })

    // Transform data
    let newConversations = []
    lastUnseenMessages.map((u) => {
      let user = {
        id: u.sender.id,
        username: u.sender.username,
        fullname: u.sender.fullname,
        image: u.sender.image,
        lastMessage: u.message,
        lastMessageCreatedAt: u.createdAt,
      }

      newConversations.push(user)
    })

    // Sort users by last created messages date
    const sortedConversations = newConversations.sort((a, b) =>
      b.lastMessageCreatedAt.toString().localeCompare(a.lastMessageCreatedAt),
    )

    // Attach new conversations to auth User
    user.newConversations = sortedConversations

    return user
  },
  /**
   * Gets user by username
   *
   * @param {string} username
   */
  getUser: async (root, { username, id }, { User }) => {
    if (!username && !id) {
      throw new Error('username or id is required params.')
    }

    if (username && id) {
      throw new Error('please pass only username or only id as a param')
    }

    const query = username ? { username: username } : { id: parseInt(id) }
    const user = await prisma.user.findOne({
      where: query,
      include: {
        posts: {
          include: {
            author: {
              include: {
                followers: true,
                following: true,
                notifications: {
                  include: {
                    author: true,
                    follow: true,
                    like: true,
                    comment: true,
                  },
                },
              },
            },
            comments: {
              include: {
                author: true,
              },
            },
            likes: {
              select: {
                id: true,
                userId: true,
                postId: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        likes: true,
        followers: true,
        following: true,
        notifications: {
          include: {
            author: true,
            follow: true,
            like: true,
            comment: true,
          },
        },
      },
    })

    if (!user) {
      throw new Error("User with given params doesn't exists.")
    }

    return user
  },
  /**
   * Gets user posts by username
   *
   * @param {string} username
   * @param {int} skip how many posts to skip
   * @param {int} limit how many posts to limit
   */
  getUserPosts: async (root, { username, skip, limit }, { User, Post }) => {
    const user = await prisma.user.findOne({ where: { username: username } })

    const count = await prisma.post.count({ where: { authorId: user.id } })

    const posts = await prisma.post.findMany({
      where: { authorId: user.id },
      include: {
        author: {
          include: {
            followers: {
              select: {
                id: true,
                followerId: true,
              },
            },
            following: {
              select: {
                id: true,
                userId: true,
              },
            },
            notifications: {
              include: {
                author: true,
                follow: true,
                like: true,
                comment: true,
              },
            },
          },
        },
        likes: {
          select: {
            id: true,
            userId: true,
            postId: true,
          },
        },
        comments: {
          include: {
            author: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      skip: skip,
      first: limit,
      orderBy: {
        createdAt: 'desc',
      },
    })

    return { posts, count }
  },
  /**
   * Gets all users
   *
   * @param {string} userId
   * @param {int} skip how many users to skip
   * @param {int} limit how many users to limit
   */
  getUsers: async (root, { userId, skip, limit }, { User, Follow }) => {
    // Find user ids, that current user follows
    const userFollowing = []
    const follow = await prisma.follow.findMany({
      where: {
        followerId: parseInt(userId),
      },
      select: {
        userId: true,
      },
    })
    follow.map((f) => userFollowing.push(f.userId))

    const query = {
      AND: [
        {
          id: {
            not: parseInt(userId),
          },
        },
        {
          id: {
            in: userFollowing,
          },
        },
      ],
    }
    const count = await prisma.user.count({ where: query })
    const users = await prisma.user.findMany({
      where: query,
      include: {
        followers: true,
        following: true,
        notifications: {
          include: {
            author: true,
            like: true,
            comment: true,
            follow: true,
          },
        },
      },
      skip: skip,
      first: limit,
      orderBy: {
        createdAt: 'desc',
      },
    })

    return { users, count }
  },
  /**
   * Searches users by username or fullName
   *
   * @param {string} searchQuery
   */
  searchUsers: async (root, { searchQuery }, { User, authUser }) => {
    // Return an empty array if searchQuery isn't presented
    if (!searchQuery) {
      return []
    }

    const users = await prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [
              {
                username: {
                  contains: searchQuery,
                },
              },
              {
                fullName: {
                  contains: searchQuery,
                },
              },
            ],
          },
          {
            id: {
              not: authUser.id,
            },
          },
        ],
      },
      first: 50,
    })

    return users
  },
  /**
   * Gets Suggested people for user
   *
   * @param {string} userId
   */
  suggestPeople: async (root, { userId }, { User, Follow }) => {
    const LIMIT = 6

    // Find who user follows
    let userFollowing = []
    const following = await prisma.follow.findMany({
      where: {
        followerId: parseInt(userId),
      },
      include: {
        user: true,
      },
    })
    following.map((f) => userFollowing.push(f.userId))

    // Find random users
    const usersCount = await prisma.user.count({
      where: {
        id: {
          in: userFollowing,
        },
      },
    })

    let random = Math.floor(Math.random() * usersCount)

    const usersLeft = usersCount - random
    if (usersLeft < LIMIT) {
      random = random - (LIMIT - usersLeft)
      if (random < 0) {
        random = 0
      }
    }

    const randomUsers = await prisma.user.findMany({
      where: {
        id: {
          in: userFollowing,
        },
      },
      skip: random,
      first: LIMIT,
    })

    return randomUsers
  },
  /**
   * Verifies reset password token
   *
   * @param {string} email
   * @param {string} token
   */
  verifyResetPasswordToken: async (root, { email, token }, { User }) => {
    // Check if user exists and token is valid
    const user = await prisma.user.findOne({
      where: {
        email: email,
        passwordResetToken: token,
        passwordResetTokenExpiry: {
          $gte: Date.now() - RESET_PASSWORD_TOKEN_EXPIRY,
        },
      },
    })
    if (!user) {
      throw new Error('This token is either invalid or expired!')
    }

    return { message: 'Success' }
  },
}

const Mutation = {
  /**
   * Signs in user
   *
   * @param {string} emailOrUsername
   * @param {string} password
   */
  signin: async (root, { input: { emailOrUsername, password } }, { User }) => {
    let user = await prisma.user.findOne({
      where: {
        email: emailOrUsername,
      },
    })

    if (user === null) {
      user = await prisma.user.findOne({
        where: {
          username: emailOrUsername,
        },
      })
    }

    if (user === null) {
      throw new Error('User not found.')
    }

    let isValidPassword = await bcrypt.compare(password, user.password)
    if (isValidPassword === null) {
      throw new Error('Invalid password.')
    }

    return {
      token: generateToken(user, process.env.SECRET, AUTH_TOKEN_EXPIRY),
    }
  },
  /**
   * Signs up user
   *
   * @param {string} fullName
   * @param {string} email
   * @param {string} username
   * @param {string} password
   */
  signup: async (
    root,
    { input: { fullName, email, username, password } },
    { User },
  ) => {
    // Check if user with given email or username already exists
    let user = await prisma.user.findOne({
      where: {
        email: email,
      },
    })

    if (user) {
      throw new Error(`User with given email already exists.`)
    } else {
      user = await prisma.user.findOne({
        where: {
          username: username,
        },
      })
      if (user) {
        throw new Error(`User with given username already exists.`)
      }
    }

    // Empty field validation
    if (!fullName || !email || !username || !password) {
      throw new Error('All fields are required.')
    }

    // FullName validation
    if (fullName.length > 40) {
      throw new Error('Full name no more than 40 characters.')
    }
    if (fullName.length < 4) {
      throw new Error('Full name min 4 characters.')
    }

    // Email validation
    const emailRegex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    if (!emailRegex.test(String(email).toLowerCase())) {
      throw new Error('Enter a valid email address.')
    }

    // Username validation
    const usernameRegex = /^(?!.*\.\.)(?!.*\.$)[^\W][\w.]{0,29}$/
    if (!usernameRegex.test(username)) {
      throw new Error(
        'Usernames can only use letters, numbers, underscores and periods.',
      )
    }
    if (username.length > 20) {
      throw new Error('Username no more than 50 characters.')
    }
    if (username.length < 3) {
      throw new Error('Username min 3 characters.')
    }
    const frontEndPages = [
      'forgot-password',
      'reset-password',
      'explore',
      'people',
      'notifications',
      'post',
    ]
    if (frontEndPages.includes(username)) {
      throw new Error("This username isn't available. Please try another.")
    }

    // Password validation
    if (password.length < 6) {
      throw new Error('Password min 6 characters.')
    }

    let newUser = await prisma.user.create({
      data: {
        fullName: fullName,
        email: email,
        username: username,
        password: await bcrypt.hash(password, bcrypt.genSaltSync(10)),
      },
    })

    return {
      token: generateToken(newUser, process.env.SECRET, AUTH_TOKEN_EXPIRY),
    }
  },
  /**
   * Requests reset password
   *
   * @param {string} email
   */
  requestPasswordReset: async (root, { input: { email } }, { User }) => {
    // Check if user exists
    const user = await prisma.user.findOne({ where: { email: email } })
    if (!user) {
      throw new Error(`No such user found for email ${email}.`)
    }

    // Set password reset token and it's expiry
    const token = generateToken(
      user,
      process.env.SECRET,
      RESET_PASSWORD_TOKEN_EXPIRY,
    )
    const tokenExpiry = Date.now() + RESET_PASSWORD_TOKEN_EXPIRY
    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        passwordResetToken: token,
        passwordResetTokenExpiry: tokenExpiry,
      },
    })

    // Email user reset link
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?email=${email}&token=${token}`
    const mailOptions = {
      to: email,
      subject: 'Password Reset',
      html: resetLink,
    }

    await sendEmail(mailOptions)

    // Return success message
    return {
      message: `A link to reset your password has been sent to ${email}`,
    }
  },
  /**
   * Resets user password
   *
   * @param {string} email
   * @param {string} token
   * @param {string} password
   */
  resetPassword: async (
    root,
    { input: { email, token, password } },
    { User },
  ) => {
    if (!password) {
      throw new Error('Enter password and Confirm password.')
    }

    if (password.length < 6) {
      throw new Error('Password min 6 characters.')
    }

    // Check if user exists and token is valid
    const user = await prisma.user.update({
      where: {
        email: email,
        passwordResetToken: token,
        passwordResetTokenExpiry: {
          $gte: Date.now() - RESET_PASSWORD_TOKEN_EXPIRY,
        },
      },
      data: {
        passwordResetToken: '',
        passwordResetTokenExpiry: '',
        password: encodePassword(password),
      },
    })
    if (!user) {
      throw new Error('This token is either invalid or expired!.')
    }

    // Return success message
    return {
      token: generateToken(user, process.env.SECRET, AUTH_TOKEN_EXPIRY),
    }
  },
  /**
   * Uploads user Profile or Cover photo
   *
   * @param {string} id
   * @param {obj} image
   * @param {string} imagePublicId
   * @param {bool} isCover is Cover or Profile photo
   */
  uploadUserPhoto: async (
    root,
    { input: { id, image, imagePublicId, isCover } },
    { User },
  ) => {
    const { createReadStream } = await image
    const stream = createReadStream()
    const uploadImage = await uploadToCloudinary(stream, 'user', imagePublicId)

    if (uploadImage.secure_url) {
      const fieldsToUpdate = {}
      if (isCover) {
        fieldsToUpdate.coverImage = uploadImage.secure_url
        fieldsToUpdate.coverImagePublicId = uploadImage.public_id
      } else {
        fieldsToUpdate.image = uploadImage.secure_url
        fieldsToUpdate.imagePublicId = uploadImage.public_id
      }

      const updatedUser = await prisma.user.update({
        where: {
          id: parseInt(id),
        },
        data: fieldsToUpdate,
      })
      return updatedUser
    }

    throw new Error('Something went wrong while uploading image to Cloudinary.')
  },
}

const Subscription = {
  /**
   * Subscribes to user's isOnline change event
   */
  isUserOnline: {
    subscribe: withFilter(
      () => pubSub.asyncIterator(IS_USER_ONLINE),
      (payload, variables, { authUser }) =>
        variables.authUserId === authUser.id,
    ),
  },
}

export default { Query, Mutation, Subscription }
